import { createGitHubDataStore } from "../../src/infrastructure/github-data-store.js";
import { installGitHubEdgeRuntime } from "./github-edge-runtime.js";

const STORAGE_KEY="yardhub:github-data-connection:v1";
const nativeFetch=window.fetch.bind(window);
const overlay=document.getElementById("yardhub-github-connect-overlay");
const form=document.getElementById("yardhub-github-connect-form");
const statusNode=overlay?.querySelector("[data-yardhub-github-status]");
let activeRuntime=null;
let activeStore=null;

function status(message,isError=false){
  if(statusNode){statusNode.textContent=message;statusNode.dataset.state=isError?"error":"info";}
  const auth=document.getElementById("authMsg");
  if(auth&&!document.getElementById("yardhub-github-connect-overlay")?.hidden)auth.textContent=message;
}
function readSaved(){
  try{
    const value=JSON.parse(localStorage.getItem(STORAGE_KEY)||"null");
    if(value&&typeof value.owner==="string"&&typeof value.repo==="string"&&typeof value.token==="string")return value;
  }catch{}
  return null;
}
function saveConnection(value){
  localStorage.setItem(STORAGE_KEY,JSON.stringify(value));
}
function showOverlay(){
  if(overlay)overlay.hidden=false;
  document.body.classList.add("yardhub-github-locked");
}
function hideOverlay(){
  if(overlay)overlay.hidden=true;
  document.body.classList.remove("yardhub-github-locked");
}
function setEndpoints(){
  const base="https://github-native.invalid/functions/v1/";
  window.DOWNTIME_CENTRAL_API=base+"central-bank";
  window.CENTRAL_CONFIG_ADMIN_API=base+"central-config-admin";
  window.GATELOG_API=base+"gatelog-api";
  window.PHOTO_EVIDENCE_API=base+"photo-evidence";
  window.REPAIR_MAINTENANCE_API=base+"repair-maintenance-api";
  window.SPECTATOR_READ_API=base+"spectator-read";
  window.YARD_HUB_SETTINGS_API=base+"yard-hub-settings-api";
  window.SUPABASE_URL="";
  window.SUPABASE_ANON_KEY="";
}
async function verifyPrivateRepository(connection){
  const response=await nativeFetch("https://api.github.com/repos/"+encodeURIComponent(connection.owner)+"/"+encodeURIComponent(connection.repo),{
    headers:{Accept:"application/vnd.github+json",Authorization:"Bearer "+connection.token,"X-GitHub-Api-Version":"2022-11-28"}
  });
  let metadata={};try{metadata=await response.json()}catch{}
  if(!response.ok)throw new Error(metadata.message||"GitHub could not open the configured data repository.");
  if(metadata.private!==true)throw new Error("The YARDHUB operational data repository must be private.");
  if(metadata.archived===true)throw new Error("The YARDHUB operational data repository is archived and cannot be changed.");
  return metadata;
}
async function connect(connection){
  if(!connection||!connection.owner||!connection.repo||!connection.token)throw new Error("Enter the private data repository and its fine-grained token.");
  const forbidden=(connection.owner+"/"+connection.repo).toLowerCase();
  if(forbidden==="aka30art/downtime"||forbidden==="aka30art/downtimeui")throw new Error("The protected DOWNTIME repository and application source repository cannot be used for operational data.");
  status("Checking private GitHub repository access…");
  const metadata=await verifyPrivateRepository(connection);
  connection.branch=connection.branch||metadata.default_branch||"main";
  const store=createGitHubDataStore({
    owner:connection.owner,repo:connection.repo,branch:connection.branch,
    token:connection.token,systemId:"YARDHUB-PRIMARY",fetchImpl:nativeFetch
  });
  status("Preparing the empty YARDHUB data structure…");
  await store.ensureAuthority();
  const runtime=await installGitHubEdgeRuntime({store,fetchImpl:nativeFetch});
  activeStore=store;activeRuntime=runtime;
  await window.DowntimeCentral.configureGitHubRuntime(runtime);
  setEndpoints();
  saveConnection(connection);
  window.YARDHUB_GITHUB_STORE=store;
  window.YARDHUB_GITHUB_RUNTIME=runtime;
  window.YARDHUB_GITHUB_CONNECTED=true;
  hideOverlay();
  status("Connected to private GitHub data repository · "+connection.owner+"/"+connection.repo);
  window.dispatchEvent(new Event("yardhub:github-connected"));
  return {store,runtime};
}
function valuesFromForm(){
  const data=new FormData(form);
  return {
    owner:String(data.get("owner")||"").trim(),
    repo:String(data.get("repo")||"").trim(),
    branch:String(data.get("branch")||"main").trim(),
    token:String(data.get("token")||"").trim()
  };
}
async function connectFromForm(){
  const connection=valuesFromForm();
  const submit=form?.querySelector('[type="submit"]');
  if(submit)submit.disabled=true;
  try{
    await connect(connection);
    if(form){const token=form.querySelector('[name="token"]');if(token)token.value="";}
  }catch(error){
    window.YARDHUB_GITHUB_CONNECTED=false;
    status(error?.message||"GitHub connection failed.",true);
  }finally{if(submit)submit.disabled=false}
}
form?.addEventListener("submit",event=>{event.preventDefault();void connectFromForm()});
const createButton=form?.querySelector("[data-create-private]");
if(createButton){
  createButton.hidden=true;
  createButton.disabled=true;
}
const saved=readSaved();
if(saved){
  showOverlay();
  if(form){
    for(const [name,value] of Object.entries({owner:saved.owner,repo:saved.repo,branch:saved.branch||"main"})){
      const field=form.querySelector('[name="'+name+'"]');if(field)field.value=value;
    }
  }
  connect(saved).catch(error=>{
    window.YARDHUB_GITHUB_CONNECTED=false;
    status((error?.message||"Saved GitHub connection could not be restored.")+" Re-enter the repository token to reconnect.",true);
    const token=form?.querySelector('[name="token"]');if(token)token.focus();
  });
}else{
  showOverlay();
  status("First setup: create a private GitHub repository, then connect its fine-grained token.");
}
window.YARDHUB_GITHUB_READY=()=>Boolean(window.YARDHUB_GITHUB_CONNECTED);
window.YARDHUB_GITHUB_REFRESH=async()=>{
  if(!activeStore)throw new Error("GitHub data repository is not connected.");
  const result=await activeStore.readDatabase();
  window.dispatchEvent(new CustomEvent("yardhub:shared-data-refreshed",{detail:{headSha:result.headSha,refreshedAt:new Date().toISOString()}}));
  return result;
};
window.addEventListener("beforeunload",()=>{void activeRuntime?.dispose?.()});
