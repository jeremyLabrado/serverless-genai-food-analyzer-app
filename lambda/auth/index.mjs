import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";

const client = new SecretsManagerClient({ region: "us-east-1" });
const secretName = "FoodAnalyzerSecretConfig";

import * as jose from "jose";
import axios from "axios";
import { Sha256 } from "@aws-crypto/sha256-js";

const REGION = "us-east-1";

const getSecrets = async () => {
  try {
    const data = await client.send(
      new GetSecretValueCommand({ SecretId: secretName })
    );
    if ("SecretString" in data) {
      return JSON.parse(data.SecretString);
    } else if ("SecretBinary" in data) {
      const buff = Buffer.from(data.SecretBinary, "base64");
      return JSON.parse(buff.toString("ascii"));
    }
  } catch (err) {
    console.error("Error fetching secret:", err);
    throw err;
  }
};

// Compute SHA256 hash of body for OAC Lambda URL signing
async function computeBodyHash(body) {
  const hash = new Sha256();
  hash.update(body || "");
  const digest = await hash.digest();
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function prepareRequest(request) {
  if (!request.origin.hasOwnProperty("custom"))
    throw (
      "Unexpected origin type. Expected 'custom'. Got: " +
      JSON.stringify(request.origin)
    );

  // Remove the behavior path prefix from the URI
  let uri = request.uri.substring(1);
  let urisplit = uri.split("/");
  urisplit.shift();
  uri = "/" + urisplit.join("/");
  request.uri = uri;

  // Set host header to origin domain (required for OAC signing)
  const hostname = request.origin.custom.domainName;
  request.headers["host"] = [{ key: "Host", value: hostname }];

  // Remove viewer authorization header — OAC will add its own SigV4 Authorization
  delete request.headers["authorization"];

  // Compute body hash for POST requests (required by Lambda URL OAC)
  if (request.body && request.body.data) {
    const bodyBytes = Buffer.from(request.body.data, request.body.encoding);
    const hash = await computeBodyHash(bodyBytes);
    request.headers["x-amz-content-sha256"] = [
      { key: "x-amz-content-sha256", value: hash },
    ];
  } else {
    // Empty body hash
    const hash = await computeBodyHash("");
    request.headers["x-amz-content-sha256"] = [
      { key: "x-amz-content-sha256", value: hash },
    ];
  }

  console.log("PREPARED", JSON.stringify({
    method: request.method,
    uri: request.uri,
    hostname,
    hasBody: !!(request.body && request.body.data),
  }));

  return request;
}

const getToken = async (authorization) => {
  return new Promise((resolve, reject) => {
    try {
      const [, token] = authorization.split(" ");
      resolve(token);
    } catch (error) {
      reject(error);
    }
  });
};

async function verifyToken(authorization) {
  const token = await getToken(authorization);
  const secrets = await getSecrets();
  
  const jwksRes = await axios.get(
    `https://cognito-idp.${REGION}.amazonaws.com/${secrets.UserPoolID}/.well-known/jwks.json`
  );

  const jwk = jose.createLocalJWKSet(jwksRes.data);
  try {
    const { payload } = await jose.jwtVerify(token, jwk, {
      issuer: `https://cognito-idp.${REGION}.amazonaws.com/${secrets.UserPoolID}`,
    });
    if (payload.client_id === secrets.ClientID) {
      return true;
    }
  } catch (err) {
    console.error(`token verification failed: ${err.name}`);
  }

  return false;
}

export const handler = async (event) => {
  try {
    const request = event.Records[0].cf.request;

    if(request.method === 'OPTIONS') {
      return {
        status: "204",
        headers: {
                'access-control-allow-origin': [{
                    key: 'Access-Control-Allow-Origin',
                    value: "*",
                }],
                 'access-control-request-method': [{
                    key: 'Access-Control-Request-Method',
                    value: "POST, GET, OPTIONS",
                }],
                 'access-control-allow-headers': [{
                    key: 'Access-Control-Allow-Headers',
                    value: "*",
                }]
        },
      }
    }
    const authorization = request.headers.authorization && request.headers.authorization[0]?.value;
    if (authorization) {
      
      const valid = await verifyToken(
        authorization       
      );

      if (valid === true) {
        const preparedRequest = await prepareRequest(request);
        return preparedRequest;
      } else {
        return {
          status: "400",
          statusDescription: "Bad Request",
          body: "Invalid token",
        };
      }
    } else {
      return {
        status: "400",
        statusDescription: "Bad Request",
        body: "No token found in Authorization header",
      };
    }
  } catch (e) {
    console.error("Auth handler error:", e.message || e);
    return {
      status: "400",
      statusDescription: "Bad Request",
      body: "Bad request",
    };
  }
};
