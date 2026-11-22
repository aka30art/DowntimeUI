import assert from "node:assert/strict";
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const root=path.resolve(".");
const mime={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".json":"application/json; charset=utf-8"};
const server=http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url||"/","http://127.0.0.1");
    const pathname=decodeURIComponent(url.pathname==="/" ? "/index.html":url.pathname);
    const file=path.resolve(root,"."+pathname);
    if(!file.startsWith(root+path.sep)&&file!==root)throw new Error("Path outside workspace");
    const body=await readFile(file);
    res.writeHead(200,{"Content-Type":mime[path.extname(file)]||"application/octet-stream","Cache-Control":"no-store"});
    res.end(body);
  }catch{
    res.writeHead(404,{"Content-Type":"text/plain"});res.end("Not found");
  }
});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const address=server.address();
const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
const failures=[];
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
  page.on("pageerror",error=>failures.push(error.message));
  await page.goto("http://127.0.0.1:"+address.port,{waitUntil:"networkidle"});
  assert.match(await page.title(),/DOWNTIMEUI/);
  await page.getByRole("heading",{name:"Set up your workspace."}).waitFor();

  await page.locator('[data-action="next"]').click();
  await page.locator('[data-path="identity.companyName"]').fill("Browser QA Company");
  await page.locator('[data-path="identity.timezone"]').fill("Europe/London");
  await page.locator('[data-action="next"]').click();

  await page.locator('[data-path="site.siteName"]').fill("QA Test Site");
  await page.locator('[data-action="add-area"]').click();
  await page.locator('[data-path="site.areas.0.name"]').fill("Production");
  await page.locator('[data-action="add-station"]').click();
  await page.locator('[data-path="site.stations.0.name"]').fill("Line 1");
  await page.locator('[data-path="site.stations.0.areaId"]').selectOption({label:"Production"});
  await page.locator('[data-action="next"]').click();

  await page.locator('[data-action="add-reason"]').click();
  await page.locator('[data-path="downtime.reasons.0.name"]').fill("Mechanical fault");
  await page.locator('[data-action="next"]').click();

  for(const day of ["mon","tue","wed","thu","fri","sat","sun"]){
    const checkbox=page.locator('[data-day="'+day+'"]');
    if(!(await checkbox.isChecked()))await checkbox.check();
  }
  await page.locator('[data-action="add-shift"]').click();
  await page.locator('[data-path="schedule.shifts.0.name"]').fill("Day shift");
  await page.locator('[data-path="schedule.shifts.0.start"]').fill("06:30");
  await page.locator('[data-path="schedule.shifts.0.end"]').fill("16:00");
  await page.locator('[data-action="add-break"]').click();
  await page.locator('[data-path="schedule.breaks.0.name"]').fill("Meal break");
  await page.locator('[data-path="schedule.breaks.0.start"]').fill("12:00");
  await page.locator('[data-path="schedule.breaks.0.end"]').fill("12:30");
  await page.locator('[data-action="next"]').click();

  await page.locator('[data-action="add-staff"]').click();
  await page.locator('[data-path="staff.0.name"]').fill("Operator One");
  await page.locator('[data-action="next"]').click();

  await page.locator('[data-action="add-role"]').click();
  await page.locator('[data-path="roles.0.name"]').fill("Supervisor");
  await page.locator('[data-action="next"]').click();

  await page.locator('[data-action="add-task"]').click();
  await page.locator('[data-path="dailyTasks.0.name"]').fill("Safety inspection");
  await page.locator('[data-action="add-task"]').click();
  await page.locator('[data-path="dailyTasks.1.name"]').fill("Equipment check");
  await page.locator('[data-action="next"]').click();

  await page.getByRole("heading",{name:"Review before installation"}).waitFor();
  assert.match(await page.locator(".setup-review").innerText(),/Browser QA Company/);
  await page.locator('[data-action="install"]').click();
  await page.getByRole("heading",{name:"Workspace configured."}).waitFor();
  await page.locator('[data-action="open-preview"]').click();

  await page.getByRole("heading",{name:"Monday",exact:true}).waitFor().catch(async()=>{
    await page.locator(".workspace-section h1").waitFor();
  });
  assert.match(await page.locator(".workspace-root").innerText(),/LOCAL MODE · SINGLE DEVICE/);
  assert.match(await page.locator(".workspace-root").innerText(),/09h 00m/,"Configured 9h net working time should appear in the daily summary.");
  await page.screenshot({path:"artifacts/workspace-desktop.png",fullPage:true});

  await page.locator('[name="entry-area"]').fill("Production");
  await page.locator('[name="entry-station"]').selectOption({label:"Line 1"});
  await page.locator('[name="entry-reason"]').fill("Mechanical fault");
  await page.locator('[name="entry-hours"]').fill("0");
  await page.locator('[name="entry-minutes"]').fill("30");
  await page.locator('[data-action="save-entry"]').click();
  await page.getByText("Mechanical fault",{exact:true}).waitFor();
  await page.locator("[data-operator]").selectOption({label:"Operator One"});

  await page.locator('[data-view="tasks"]').click();
  const taskChecks=page.locator("input[data-task]");
  assert.equal(await taskChecks.count(),2);
  await taskChecks.nth(0).check();
  await page.locator('[data-action="lock-tasks"]').click();
  await page.getByText("Saved and locked",{exact:false}).waitFor();
  assert.equal(await taskChecks.nth(0).isDisabled(),true);

  await page.reload({waitUntil:"networkidle"});
  await page.locator('[data-view="tasks"]').click();
  assert.equal(await page.locator("input[data-task]").nth(0).isDisabled(),true,"Locked checklist must remain immutable after reload.");
  assert.equal(await page.locator("input[data-task]").nth(0).isChecked(),true,"Task completion must persist after reload.");

  await page.locator('[data-view="weekly"]').click();
  await page.getByRole("heading",{name:"Weekly summary"}).waitFor();
  assert.match(await page.locator(".workspace-root").innerText(),/Mechanical fault/);
  await page.screenshot({path:"artifacts/workspace-weekly-desktop.png",fullPage:true});

  await page.locator('[data-view="reports"]').click();
  await page.locator('[data-action="generate-report"]').click();
  await page.getByText(/Week starting/).waitFor();
  assert.match(await page.locator(".workspace-root").innerText(),/Print \/ PDF/);

  await page.setViewportSize({width:390,height:844});
  await page.locator('[data-view="daily"]').click();
  const mobileMetrics=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth,body:document.body.scrollWidth}));
  assert.ok(mobileMetrics.document<=mobileMetrics.viewport+1,"Mobile layout must not overflow horizontally: "+JSON.stringify(mobileMetrics));
  await page.screenshot({path:"artifacts/workspace-mobile.png",fullPage:true});
  assert.deepEqual(failures,[],"Browser runtime errors: "+failures.join(" | "));
  console.log("PASS: Chromium installer, configuration, daily operations, task lock persistence, weekly summary, report archive and 390px mobile layout");
}finally{
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
