import * as mixpanel from 'mixpanel-browser';

export const config = {
    runtime: "experimental-edge",
};

function parseCSPData(headers, body) {
    var userAgent = headers.get('user-agent');
    var referer = headers.get('referer');
    var xffor = headers.get('x-forwarded-for');
    var timestamp = new Date().toISOString();
    var cspData;


    try {
        cspData = {};
        cspData["timestamp"] = timestamp;
        cspData["client-ip"] = xffor;
        cspData["user-agent"] = userAgent;
        cspData["immediate-referer"] = referer;

        if (body["csp-report"]) {
            cspData["parse"] = "valid";
            cspData["error"] = "";
            cspData["csp-report"] = body["csp-report"];
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
        const response = await fetch(`${url.origin}/prism/preauth/info`);
        const { config } = await response.json();
        clusterDetailsCache.set(url.origin, config.mixpanelConfig);
        return config.mixpanelConfig;
    } catch (e) {
        console.error(e);
        return null;
    }
}

async function trackCSPReport(cspData) {
    const clusterDetails = await getClusterDetails(cspData['document-uri']);
    if (!clusterDetails) {
        return;
    }

    const key = (clusterDetails.production) ? clusterDetails.prodSdkKey : clusterDetails.devSdkKey;
    const mixpanelInstance = mixpanel.init(key, undefined, "mixpanel-csp-report");
    mixpanelInstance.track('CSP_REPORT', {
        ...cspData,
        clusterId: clusterDetails.clusterId,
        clusterName: clusterDetails.clusterName,
        hostAppUrl: cspData.referrer,
    });
}


export default async (req) => {
    const body = await req.json();
    console.log("CSP Report received", body);
    var cspData = parseCSPData(req.headers, body);
    console.log(cspData);
    await trackCSPReport(cspData);

    return new Response(JSON.stringify(cspData), {
        status: 200,
        headers: {
            'content-type': 'application/json;charset=UTF-8',
        }
    });
}