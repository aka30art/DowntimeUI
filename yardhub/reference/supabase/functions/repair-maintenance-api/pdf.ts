import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";
const W=595.28,H=841.89,M=34;
const MACHINES=[{key:"KIVERCO_PICKING_LINE",label:"KIVERCO - PICKING LINE"},{key:"TANNA_SHREDDER",label:"TANNA - SHREDDER"},{key:"FORKLIFT",label:"FORKLIFT"},{key:"TELEHANDLER",label:"TELEHANDLER"},{key:"EXCAVATORS_360",label:"360 EXCAVATORS"},{key:"OTHER_EQUIPMENT",label:"OTHER EQUIPMENT"}] as const;
type Fault={machine_type?:string;asset_id?:string|null;asset_name?:string|null;asset_code?:string|null;fault_name?:string;description?:string;priority?:string;status?:string;created_at?:string};
const clean=(v:unknown)=>String(v??"").replace(/[–—]/g,"-").replace(/[‘’]/g,"'").replace(/[“”]/g,'"').replace(/·/g,"/").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/[^\x20-\x7E]/g,"?").replace(/\s+/g," ").trim();
const dateText=(v:unknown)=>{const d=new Date(String(v??""));return Number.isNaN(d.getTime())?"-":d.toLocaleString("en-GB",{timeZone:"Europe/London"})};
function wrap(v:unknown,font:any,size:number,width:number){const words=(clean(v)||"-").split(" "),lines:string[]=[];let line="";for(const word of words){const candidate=line?line+" "+word:word;if(font.widthOfTextAtSize(candidate,size)<=width){line=candidate;continue}if(line)lines.push(line);line="";let part="";for(const ch of word){if(part&&font.widthOfTextAtSize(part+ch,size)>width){lines.push(part);part=ch}else part+=ch}line=part}if(line)lines.push(line);return lines.length?lines:["-"]}
export async function buildRepairMaintenancePdf(records:Fault[],filter:string|null,generatedAt=new Date(),assetScopeName:string|null=null){
 const doc=await PDFDocument.create();doc.setTitle("R&M Machinery Defect and Fault Register");doc.setSubject(assetScopeName||filter||"All machinery");doc.setCreationDate(generatedAt);doc.setModificationDate(generatedAt);
 const regular=await doc.embedFont(StandardFonts.Helvetica),bold=await doc.embedFont(StandardFonts.HelveticaBold);
 const ink=rgb(.055,.105,.15),muted=rgb(.33,.40,.47),yellow=rgb(1,.82,.10),pale=rgb(.92,.95,.97),line=rgb(.76,.81,.86);
 const groups=(filter?MACHINES.filter(x=>x.key===filter):MACHINES).flatMap(machine=>{
  const rows=records.filter(x=>x.machine_type===machine.key);
  if(!rows.length)return [{machine,title:assetScopeName||machine.label,rows:[]}];
  const buckets=new Map<string,{title:string;rows:Fault[]}>();
  for(const fault of rows){
   const key=fault.asset_id||"__unassigned__";
   const title=fault.asset_name?(fault.asset_name+(fault.asset_code?" / "+fault.asset_code:"")):"UNASSIGNED / LEGACY RECORDS";
   if(!buckets.has(key))buckets.set(key,{title,rows:[]});
   buckets.get(key)!.rows.push(fault);
  }
  return [...buckets.values()].map(group=>({machine,title:group.title,rows:group.rows}));
 });
 const counts=["HIGH","MEDIUM","LOW"].map(p=>records.filter(x=>x.priority===p).length),scope=assetScopeName||(filter?(MACHINES.find(x=>x.key===filter)?.label||filter):"ALL MACHINERY");
 let page=doc.addPage([W,H]),top=116;
 const text=(p:any,v:unknown,x:number,y:number,size:number,font=regular,color=ink)=>p.drawText(clean(v),{x,y:H-y-size,size,font,color});
 const header=(p:any,first:boolean)=>{p.drawRectangle({x:0,y:H-8,width:W,height:8,color:yellow});text(p,"DOWNTIME / REPAIRS & MAINTENANCE",M,25,16,bold);text(p,"MACHINERY DEFECT & FAULT REGISTER",M,47,8,bold,muted);text(p,scope,M,63,10,bold);text(p,"GENERATED: "+dateText(generatedAt.toISOString()),M,79,8,regular,muted);p.drawLine({start:{x:M,y:H-94},end:{x:W-M,y:H-94},thickness:1.3,color:yellow});if(first){const gap=7,width=(W-M*2-gap*3)/4,labels=["TOTAL FAULTS","HIGH PRIORITY","MEDIUM PRIORITY","LOW PRIORITY"],values=[records.length,...counts];for(let i=0;i<4;i++){const x=M+i*(width+gap);p.drawRectangle({x,y:H-164,width,height:48,color:pale,borderColor:line,borderWidth:.6});text(p,labels[i],x+8,116,6.5,bold,muted);text(p,String(values[i]),x+8,131,17,bold)}top=178}else top=108};
 const addPage=()=>{page=doc.addPage([W,H]);header(page,false)};
 const widths=[24,91,205,54,57,96],tableHead=()=>{const labels=["#","AREA / PART","TYPE OF DEFECT","PRIORITY","STATUS","RECORDED"],height=23;page.drawRectangle({x:M,y:H-top-height,width:widths.reduce((a,b)=>a+b,0),height,color:pale,borderColor:line,borderWidth:.6});let x=M;labels.forEach((label,i)=>{text(page,label,x+4,top+7,6.2,bold,muted);x+=widths[i]});top+=height};
 header(page,true);
 for(const group of groups){if(top+60>H-44)addPage();page.drawRectangle({x:M,y:H-top-26,width:W-M*2,height:26,color:pale});page.drawRectangle({x:M,y:H-top-26,width:5,height:26,color:yellow});text(page,group.machine.label+" / "+group.title,M+12,top+7,10,bold);top+=31;tableHead();
  if(!group.rows.length){const h=25;if(top+h>H-44){addPage();tableHead()}page.drawRectangle({x:M,y:H-top-h,width:widths.reduce((a,b)=>a+b,0),height:h,borderColor:line,borderWidth:.6});text(page,"No faults or defects recorded.",M+6,top+7,8,regular,muted);top+=h+12;continue}
  let n=0;for(const f of group.rows){const values=[String(n+1).padStart(2,"0"),f.fault_name||"-",f.description||"-",f.priority||"-",f.status||"-",dateText(f.created_at)],cells=values.map((v,i)=>wrap(v,i===0?bold:regular,7,widths[i]-8)),height=Math.max(22,Math.max(...cells.map(x=>x.length))*9+8);
   if(top+height>H-44){addPage();page.drawRectangle({x:M,y:H-top-24,width:W-M*2,height:24,color:pale});page.drawRectangle({x:M,y:H-top-24,width:5,height:24,color:yellow});text(page,group.machine.label+" / "+group.title+" (CONTINUED)",M+12,top+6,9,bold);top+=28;tableHead()}
   const bottom=H-top-height,tw=widths.reduce((x,y)=>x+y,0);if(n%2)page.drawRectangle({x:M,y:bottom,width:tw,height,color:rgb(.975,.98,.985)});page.drawRectangle({x:M,y:bottom,width:tw,height,borderColor:line,borderWidth:.45});let x=M;
   cells.forEach((cell,i)=>{cell.forEach((str,j)=>text(page,str,x+4,top+4+j*9,7,i===0?bold:regular,i===3&&values[3]==="HIGH"?rgb(.7,.12,.15):ink));x+=widths[i]});top+=height;n++}
  top+=14
 }
 const pages=doc.getPages();pages.forEach((p,i)=>{p.drawLine({start:{x:M,y:31},end:{x:W-M,y:31},thickness:.6,color:line});p.drawText("YARD HUB / R&M / INTERNAL MAINTENANCE REPORT",{x:M,y:18,size:7,font:regular,color:muted});p.drawText("PAGE "+(i+1)+" OF "+pages.length,{x:W-M-64,y:18,size:7,font:bold,color:muted})});
 return await doc.save()
}