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

        if (cspData["csp-report"]) {
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

export default async (req) => {
    const body = await req.json();
    console.log("CSP Report received", body);
    var cspData = parseCSPData(req.headers, body);
    console.log(cspData);
    return new Response(JSON.stringify(cspData), {
        status: 200,
        headers: {
            'content-type': 'application/json;charset=UTF-8',
        }
    });
}