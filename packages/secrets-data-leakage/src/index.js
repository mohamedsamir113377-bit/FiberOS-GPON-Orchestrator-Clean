
import fs from "node:fs";
import path from "node:path";

const DEFAULT_IGNORE = new Set([".git","node_modules","coverage","dist",".cache",".next"]);
const MAX_BYTES = 2_000_000;
const rules = [
  {id:"AWS_ACCESS_KEY", re:/\bAKIA[0-9A-Z]{16}\b/g, severity:"HIGH"},
  {id:"PRIVATE_KEY", re:/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g, severity:"CRITICAL"},
  {id:"JWT_LIKE", re:/\beyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\b/g, severity:"HIGH"},
  {id:"GENERIC_SECRET_ASSIGNMENT", re:/\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|secret[_-]?key|password)\b\s*[:=]\s*["'`][^"'`\\n]{8,}["'`]/gi, severity:"HIGH"},
  {id:"BEARER_TOKEN", re:/\bBearer\s+[A-Za-z0-9._~+/=-]{16,}\b/g, severity:"HIGH"},
  {id:"BASIC_CREDENTIAL_URL", re:/\b[a-z][a-z0-9+.-]*:\/\/[^\/\s:@]+:[^\/\s@]+@/gi, severity:"HIGH"},
  {id:"PRIVATE_CREDENTIAL_FILE_REFERENCE", re:/\b(?:\.env|id_rsa|id_ed25519|credentials\.json|service-account.*\.json)\b/gi, severity:"INFO"}
];

function walk(root,out=[]){
  for(const ent of fs.readdirSync(root,{withFileTypes:true})){
    if(DEFAULT_IGNORE.has(ent.name)) continue;
    const p=path.join(root,ent.name);
    if(ent.isDirectory()) walk(p,out); else out.push(p);
  }
  return out;
}
function isTextFile(p){
  try{
    const st=fs.statSync(p); if(st.size>MAX_BYTES) return false;
    const b=fs.readFileSync(p); for(const x of b) if(x===0) return false; return true;
  }catch{return false}
}
function isTemplateOnlyCredentialUrlMatch(raw){
  const at = raw.lastIndexOf("@");
  if (at < 0) return false;
  const authority = raw.slice(raw.indexOf("://") + 3, at);
  const colon = authority.indexOf(":");
  if (colon < 0) return false;
  const password = authority.slice(colon + 1);
  // Compose/runtime templates may legitimately contain a credential placeholder,
  // e.g. postgres://user:${POSTGRES_PASSWORD}@host. This is not secret material.
  return /^\$\{[A-Za-z_][A-Za-z0-9_]*(?::-[^}]*)?\}$/.test(password);
}
export function scanTree(root){
  const findings=[];
  for(const file of walk(root)){
    if(file.endsWith("packages/secrets-data-leakage/src/index.js")) continue;
    if(!isTextFile(file)) continue;
    const text=fs.readFileSync(file,"utf8");
    for(const rule of rules){
      rule.re.lastIndex=0; let m;
      while((m=rule.re.exec(text))){
        if(rule.id === "BASIC_CREDENTIAL_URL" && isTemplateOnlyCredentialUrlMatch(m[0])) continue;
        const line=text.slice(0,m.index).split(/\n/).length;
        const raw=m[0]; const masked=raw.length>12?raw.slice(0,5)+"…"+raw.slice(-3):"…";
        findings.push({rule:rule.id,severity:rule.severity,file:path.relative(root,file),line,sample:masked});
        if(findings.length>1000) return findings;
      }
    }
  }
  return findings;
}
export function redact(value){
  if(typeof value!=="string") return value;
  return value
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{16,}/gi,"$1[REDACTED]")
    .replace(/(password|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|secret[_-]?key)(\s*[:=]\s*)["'`][^"'`\\n]{4,}["'`]/gi,"$1$2[REDACTED]")
    .replace(/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g,"[REDACTED_PRIVATE_KEY]");
}
export function assertNoSecrets(value){
  if(typeof value !== "string") return true;
  for(const rule of rules){
    if(rule.severity === "INFO") continue;
    rule.re.lastIndex = 0;
    let match;
    while((match = rule.re.exec(value))){
      if(rule.id === "BASIC_CREDENTIAL_URL" && isTemplateOnlyCredentialUrlMatch(match[0])) continue;
      throw new Error("SENSITIVE_VALUE_DETECTED:" + rule.id);
    }
  }
  return true;
}
