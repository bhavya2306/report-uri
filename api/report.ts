import Mixpanel from 'mixpanel';
import { VercelRequest, VercelResponse } from '@vercel/node'

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const ERROR_CODES = {
    CSP_PARSE_ERROR: 'CSP_PARSE_ERROR',
    CLUSTER_DETAILS_ERROR: 'CLUSTER_DETAILS_ERROR', 
    MIXPANEL_TRACK_ERROR: 'MIXPANEL_TRACK_ERROR',
    CSP_TRACK_ERROR: 'CSP_TRACK_ERROR',
    REQUEST_HANDLER_ERROR: 'REQUEST_HANDLER_ERROR'
};

function parseCSPData(headers, body) {
    const userAgent = headers['user-agent'];
    const referer = headers['referer'];
    const xffor = headers['x-forwarded-for'];
    let cspData = {};


    try {
        cspData["client-ip"] = xffor;
        cspData["user-agent"] = userAgent;
        cspData["immediate-referer"] = referer;

        if (body["csp-report"]) {
            cspData["parse"] = "valid";
            cspData["error"] = "";
            Object.assign(cspData, body["csp-report"]);
        }
        else {
            cspData["parse"] = "error";
            cspData["error"] = "csp-report object not found";
        }
    }
    catch (e) {
        console.error(ERROR_CODES.CSP_PARSE_ERROR, e);
        cspData["parse"] = "error";
        cspData["error"] = e;
    }

    return cspData;
}

const clusterDetailsCache = new Map();
async function getClusterDetails(documentUri: string): Promise<any> {
    try {
        const url = new URL(documentUri);
        if (clusterDetailsCache.has(url.origin)) {
            return clusterDetailsCache.get(documentUri);
        }
        const response = await fetch(`${url.origin}/prism/preauth/info`, { signal: AbortSignal.timeout(20000) });
        const { config } = await response.json();
        clusterDetailsCache.set(url.origin, config.mixpanelConfig);
        return config.mixpanelConfig;
    } catch (e) {
        console.error(ERROR_CODES.CLUSTER_DETAILS_ERROR, e);
        return null;
    }
}

function getMixpanelKey(clusterDetails, documentUri) {
    if (clusterDetails) {
        return (clusterDetails.production) ? clusterDetails.prodSdkKey : clusterDetails.devSdkKey
    }

    if (documentUri?.includes(':')) {
        return process.env.MIXPANEL_DEV_KEY;
    } else {
        return process.env.MIXPANEL_PROD_KEY;
    }
}

async function trackCSPReport(cspData) {
    const documentUri = cspData['document-uri'];
    const clusterDetails = await getClusterDetails(documentUri);
    
    return new Promise<void>((resolve, reject) => {
        try {
            const key = getMixpanelKey(clusterDetails, documentUri);
            const mixpanel = Mixpanel.init(key);
            mixpanel.track('csp-report', {
                ...cspData,
                clusterId: clusterDetails?.clusterId,
                clusterName: clusterDetails?.clusterName,
                hostAppUrl: cspData.referrer,
            }, (e) => {
                if (e) {
                    console.error(ERROR_CODES.MIXPANEL_TRACK_ERROR, e);
                    reject(e);
                }
                else {
                    console.log('csp-report tracked');
                    resolve();
                }
            })
        } catch (e) {
            console.error(ERROR_CODES.CSP_TRACK_ERROR, e);
            reject(e);
        }
    });
}


export default async (req: VercelRequest, res: VercelResponse) => {
    if (req.method === 'OPTIONS') {
        console.log('Received OPTIONS preflight request. Responding with 204.');
        // Set necessary headers for CORS that your vercel.json might also handle
        res.setHeader('Allow', ['POST', 'OPTIONS']);
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        
        res.status(204).end();
        return;
    }
    const chunks = [];
    
    req.on('data', chunk => {
        chunks.push(chunk);
    });

    req.on('end', async () => {
        try {
            const data = Buffer.concat(chunks);
            const body = JSON.parse(data.toString());
            console.log("CSP Report received", body);
            const cspData = parseCSPData(req.headers, body);
            await trackCSPReport(cspData);
            return res.status(204).end();
        } catch (e) {
            console.error(ERROR_CODES.REQUEST_HANDLER_ERROR, e);
            return res.end();
        }
    });
}