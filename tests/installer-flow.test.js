import assert from "node:assert/strict";
import { TENANT_STORAGE_KEY } from "../src/config-core.js";
class MemoryStorage {
  data=new Map();
  getItem(k){return this.data.has(k)?this.data.get(k):null;}
  setItem(k,v){this.data.set(k,String(v));}
  removeItem(k){this.data.delete(k);}
}
class Root {
  listeners={}; innerHTML=""; removed=false;
  addEventListener(type,fn){this.listeners[type]=fn;}
  remove(){this.removed=true;}
}
const store=new MemoryStorage(), root=new Root(), shell={html:"",insertAdjacentHTML(_,html){this.html=html;}};
const bannerButton={addEventListener(){}};
globalThis.localStorage=store;
globalThis.document={
  getElementById(id){return id==="installerRoot"?root:(id==="tenantEditConfig"?bannerButton:null);},
  querySelector(selector){return selector===".shell"?shell:null;}
};
await import("../src/installer.js");
assert.match(root.innerHTML,/Set up your workspace\./);
assert.match(root.innerHTML,/No company, operator, plant/);
function click(action){
  const button={dataset:{action}};
  root.listeners.click({target:{closest:()=>button}});
}
function input(path,value){
  const target={dataset:{path},value,type:"text",matches:selector=>selector==="[data-path]"};
  root.listeners.input({target});
}
click("next");
assert.match(root.innerHTML,/Company identity/);
input("identity.companyName","QA Test Company");
input("identity.timezone","Europe/London");
click("next");
assert.match(root.innerHTML,/Site and structure/);
input("site.siteName","QA Test Site");
for(let i=0;i<6;i++)click("next");
assert.match(root.innerHTML,/Review before installation/);
click("install");
assert.match(root.innerHTML,/Workspace configured\./);
const saved=JSON.parse(store.getItem(TENANT_STORAGE_KEY));
assert.equal(saved.installed,true);
assert.equal(saved.identity.companyName,"QA Test Company");
assert.equal(saved.site.siteName,"QA Test Site");
click("edit-config");
input("identity.companyName","Updated QA Company");
click("save-exit");
assert.match(root.innerHTML,/Updated QA Company/);
assert.equal(JSON.parse(store.getItem(TENANT_STORAGE_KEY)).identity.companyName,"Updated QA Company");
click("open-preview");
assert.equal(root.removed,true);
assert.match(shell.html,/LOCAL CONFIG · PREVIEW DATA ONLY/);
console.log("Installer wizard flow, local installation, edit and preview handoff: PASS");
