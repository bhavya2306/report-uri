import Mixpanel from 'mixpanel';
import { VercelRequest, VercelResponse } from '@vercel/node'

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

function parseCSPData(headers, body) {
    var userAgent = headers['user-agent'];
    var referer = headers['referer'];
    var xffor = headers['x-forwarded-for'];
    var timestamp = new Date().toISOString();
    var cspData;


    try {
        cspData = {};
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
        cspData["parse"] = "error";
        cspData["error"] = e;
    }

    return cspData;
}

const clusterDetailsCache = new Map();
async function getClusterDetails(documentUri: string): Promise<any> {
    const url = new URL(documentUri);
    if (clusterDetailsCache.has(url.origin)) {
        return clusterDetailsCache.get(documentUri);
    }

    try {
        console.log(url.origin);
        const response = await fetch(`${url.origin}/prism/preauth/info`, { signal: AbortSignal.timeout(20000) });
        const { config } = await response.json();
        clusterDetailsCache.set(url.origin, config.mixpanelConfig);
        return config.mixpanelConfig;
    } catch (e) {
        console.error(e);
        return null;
    }
}

function getMixpanelKey(clusterDetails, documentUri) {
    if (clusterDetails) {
        return (clusterDetails.production) ? clusterDetails.prodSdkKey : clusterDetails.devSdkKey
    }

    if (documentUri.includes(':')) {
        return process.env.MIXPANEL_DEV_KEY;
    } else {
        return process.env.MIXPANEL_PROD_KEY;
    }
}

async function trackCSPReport(cspData) {
    const documentUri = cspData['document-uri'];
    const clusterDetails = await getClusterDetails(documentUri);

    const key = getMixpanelKey(clusterDetails, documentUri);
    const mixpanel = Mixpanel.init(key);
    return new Promise<void>((resolve, reject) => {
        try {
            mixpanel.track('csp-report', {
                ...cspData,
                clusterId: clusterDetails?.clusterId,
                clusterName: clusterDetails?.clusterName,
                hostAppUrl: cspData.referrer,
            }, (e) => {
                if (e) {
                    console.error(e);
                    reject(e);
                }
                resolve();
                console.log('csp-report tracked');
            });
        } catch (e) {
            console.trace(e);
            reject(e);
        }
    });
}


export default async (req: VercelRequest, res: VercelResponse) => {
    const chunks = [];
    req.on('data', chunk => {
        chunks.push(chunk);
    })

    req.on('end', async () => {
        const data = Buffer.concat(chunks);
        const body = JSON.parse(data.toString());
        console.log("CSP Report received", body);
        var cspData = parseCSPData(req.headers, body);
        await trackCSPReport(cspData);
        return res.json(cspData);
    });
}