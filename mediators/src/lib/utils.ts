import utils from 'openhim-mediator-utils';
import shrMediatorConfig from '../config/shrMediatorConfig.json';
import mpiMediatorConfig from '../config/mpiMediatorConfig.json';
import advancedSearchConfig from '../config/advancedSearchConfig.json';
import ipsMediator from '../config/ipsMediatorConfig.json';
import fhirBaseMediator from '../config/fhirBaseConfig.json'

import { Agent } from 'https';
import * as crypto from 'crypto';

// ✅ Do this if using TYPESCRIPT
import { RequestInfo, RequestInit } from 'node-fetch';
import { uuid } from 'uuidv4';

// mediators to be registered
const mediators = [
    shrMediatorConfig,
    advancedSearchConfig,
    mpiMediatorConfig,
    ipsMediator,
    fhirBaseMediator
];

const fetch = (url: RequestInfo, init?: RequestInit) =>
    import('node-fetch').then(({ default: fetch }) => fetch(url, init));

const openhimApiUrl = process.env.OPENHIM_API_URL;
const openhimUsername = process.env.OPENHIM_USERNAME;
const openhimPassword = process.env.OPENHIM_PASSWORD;

const openhimConfig = {
    username: openhimUsername,
    password: openhimPassword,
    apiURL: openhimApiUrl,
    trustSelfSigned: true
}

utils.authenticate(openhimConfig, (e: any) => {
    console.log(e ? e : "✅ OpenHIM authenticated successfully");
    importMediators();
    installChannels();
})

export const importMediators = () => {
    try {
        mediators.map((mediator: any) => {
            utils.registerMediator(openhimConfig, mediator, (e: any) => {
                console.log(e ? e : "");
            });
        })
    } catch (error) {
        console.log(error);
    }
    return;
}

export const getOpenHIMToken = async () => {
    try {
        // console.log("Auth", auth)
        let token = await utils.genAuthHeaders(openhimConfig);
        return token
    } catch (error) {
        console.log(error);
        return { error, status: "error" }
    }
}

export const installChannels = async () => {
    let headers = await getOpenHIMToken();
    mediators.map(async (mediator: any) => {
        let response = await (await fetch(`${openhimApiUrl}/channels`, {
            headers: { ...headers, "Content-Type": "application/json" }, method: 'POST', body: JSON.stringify(mediator.defaultChannelConfig[0]), agent: new Agent({
                rejectUnauthorized: false
            })
        })).text();
        console.log(response);
    })
}

export let apiHost = process.env.FHIR_BASE_URL
console.log(apiHost)


// a fetch wrapper for HAPI FHIR server.
export const FhirApi = async (params: any) => {
    let _defaultHeaders = { "Content-Type": 'application/json' }
    if (!params.method) {
        params.method = 'GET';
    }
    try {
        let response = await fetch(String(`${apiHost}${params.url}`), {
            headers: _defaultHeaders,
            method: params.method ? String(params.method) : 'GET',
            ...(params.method !== 'GET' && params.method !== 'DELETE') && { body: String(params.data) }
        });
        let responseJSON = await response.json();
        let res = {
            status: "success",
            statusText: response.statusText,
            data: responseJSON
        };
        return res;
    } catch (error) {
        console.error(error);
        let res = {
            statusText: "FHIRFetch: server error",
            status: "error",
            data: error
        };
        console.error(error);
        return res;
    }
}


export const parseIdentifiers = async (patientId: string) => {
    let patient: any = (await FhirApi({ url: `/Patient?identifier=${patientId}`, })).data
    if (!(patient?.total > 0 || patient?.entry.length > 0)) {
        return null;
    }
    let identifiers = patient.entry[0].resource.identifier;
    return identifiers.map((id: any) => {
        return {
            [id.id]: id
        }
    })
}

export const sendRequest = async () => {
    let headers = await getOpenHIMToken();
    [shrMediatorConfig.urn, mpiMediatorConfig.urn].map(async (urn: string) => {
        let response = await (await fetch(`${openhimApiUrl}/patients`, {
            headers: { ...headers, "Content-Type": "application/json" }, method: 'POST', body: JSON.stringify({ a: "y" }), agent: new Agent({
                rejectUnauthorized: false
            })
        })).text();
        console.log(response);
    });
}


export const createClient = async (name: string, password: string) => {
    let headers = await getOpenHIMToken();
    const clientPassword = password
    const clientPasswordDetails: any = await genClientPassword(clientPassword)
    let response = await (await fetch(`${openhimApiUrl}/clients`, {
        headers: { ...headers, "Content-Type": "application/json" }, method: 'POST',
        body: JSON.stringify({
            passwordAlgorithm: "sha512",
            passwordHash: clientPasswordDetails.passwordHash,
            passwordSalt: clientPasswordDetails.passwordSalt,
            clientID: name, name: name, "roles": [
                "*"
            ],
        }), agent: new Agent({
            rejectUnauthorized: false
        })
    })).text();
    console.log("create client: ", response)
    return response
}


// export let apiHost = process.env.FHIR_BASE_URL


const genClientPassword = async (password: string) => {
    return new Promise((resolve) => {
        const passwordSalt = crypto.randomBytes(16);
        // create passhash
        let shasum = crypto.createHash('sha512');
        shasum.update(password);
        shasum.update(passwordSalt.toString('hex'));
        const passwordHash = shasum.digest('hex');
        resolve({
            "passwordSalt": passwordSalt.toString('hex'),
            "passwordHash": passwordHash
        })
    })
}


export const getPatientSummary = async (crossBorderId: string) => {
    try {
        let patient = await getPatientByCrossBorderId(crossBorderId)
        console.log(patient);
        let ips = (await FhirApi({ url: `/Patient/${patient.id}/$summary` })).data;
        return ips;
    } catch (error) {
        console.log(error);
        return null
    }
}



export const generateCrossBorderId = (county: string) => {
    let month = new Date().getMonth() + 1;
    let id = `${county.toUpperCase().slice(0, 2)}-${new Date().getFullYear()}-${(month < 10) ? '0' + month.toString() : month.toString()}-${uuid().slice(0, 5).toUpperCase()}`
    return id;
    // check if it exists
}

export const getPatientByCrossBorderId = async (crossBorderId: string) => {
    try {
        let patient = (await FhirApi({ url: `/Patient?identifier=${crossBorderId}` })).data;
        if (patient?.total > 0 || patient?.entry?.length > 0) {
            patient = patient.entry[0].resource;
            return patient;
        }
        return null;
    } catch (error) {
        console.log(error);
        return null;
    }
}


export const parseObservationResource = async (data: any) => {
    try {
        let codes = data
        // { observation, value }
    } catch (error) {
        console.log(error);
        return null;
    }
}

export const Observation = (patientId: string, codes: Array<any>, encounterId: string) => {
    try {
        return {
            resourceType: "Observation",
            code: { coding: codes },
            subject: { reference: `Patient/${patientId}` },
            effectiveDateTime: new Date().toISOString(),
            issued: new Date().toISOString(),
            // meta: {
            //     "profile": [
            //         "http://fhir.org/guides/who/core/StructureDefinition/who-observation",
            //     ]
            // },
        }
    } catch (error) {
        console.log(error);
        return null;
    }

}

export const parseEncounterResource = async (data: any) => {
    try {

    } catch (error) {
        console.log(error);
        return null;
    }
}





export const parseMedication = async (data: any) => {
    try {

    } catch (error) {
        console.log(error);
        return null;
    }
}


export const parseFHIRBundle = async (params: any) => {
    try {
        // return {}
    } catch (error) {
        return null
    }

}


export const generateFHIRBundle = async (params: any) => {
    try {

    } catch (error) {
        return null
    }

}