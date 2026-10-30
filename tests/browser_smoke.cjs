// Browser smoke test with mocked Frappe services; this is not a Bench integration test.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root=path.join(__dirname,'..');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
 try {
 const page=await browser.newPage({viewport:{width:1440,height:1000}}), errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.setContent('<div id="wrapper"><div class="layout-main-section"></div></div>');
 const jquery=process.env.JQUERY_PATH || require.resolve('jquery/dist/jquery.min.js');
 for(const file of [jquery,path.join(__dirname,'frappe_mock.js'),path.join(root,'thinknxg_workspace_studio/public/js/designer_model.js'),path.join(root,'thinknxg_workspace_studio/workspace_studio/page/workspace_studio/workspace_studio.js')])await page.addScriptTag({content:await fs.readFile(file,'utf8')});
 await page.addStyleTag({content:await fs.readFile(path.join(root,'thinknxg_workspace_studio/public/css/workspace_studio.css'),'utf8')});
 await page.evaluate(()=>frappe.pages['workspace-studio'].on_page_load(document.querySelector('#wrapper')));
 async function fill(label,value){const el=page.locator('[data-field="'+label+'"]');await el.fill(value);await el.dispatchEvent('change');}
 await page.locator('#wss-title').fill('Sales Operations');await page.locator('#wss-module').selectOption('Selling');
 await page.locator('[data-type="heading"]').click();await fill('Title','Quick Access');
 await page.locator('[data-type="shortcut"]').click();await fill('Title','Sales Orders');await fill('Destination','Sales Order');
 await page.locator('[data-type="chart"]').click();await fill('Dashboard Chart','Sales Trends');
 await page.locator('[data-type="number_card"]').click();await fill('Number Card','Open Orders');
 for(const surface of ['sidebar','dock','desktop']){
  await page.locator('[data-surface="'+surface+'"]').click();await page.locator('[data-type="link"]').click();await fill('Destination','Sales');
  if(surface==='sidebar'){await page.locator('[data-type="link"]').click();await fill('Destination','Sales Invoice');await page.getByRole('button',{name:'Indent',exact:true}).click();}
 }
 await page.locator('#wss-publish').click();await page.waitForFunction(()=>__calls.some(c=>c.key==='publish'));
 const saved=await page.evaluate(()=>({calls:__calls.map(c=>c.key),data:__saved}));
 assert.deepEqual(saved.calls,['bootstrap','save_design','bootstrap','publish']);
 assert.equal(JSON.parse(saved.data.layout).components[1].config.link_to,'Sales Order');
 assert.equal(JSON.parse(saved.data.navigation).items[1].indent,1);
 assert.equal(JSON.parse(saved.data.dock).entries[0].link_type,'Workspace');
 assert.equal(JSON.parse(saved.data.dock).desktop_icons.length,1);
 await page.locator('[data-surface="workspace"]').click();
 await page.locator('[data-type="text"]').dragTo(page.locator('#wss-canvas'));
 assert.equal(await page.locator('.wss-block').count(),5);
 const lastTitle=await page.locator('.wss-block strong').last().textContent();
 await page.locator('.wss-block').last().dragTo(page.locator('.wss-block').first());
 assert.equal(await page.locator('.wss-block strong').first().textContent(),lastTitle);
 await page.locator('#wss-preview').click();assert.equal(await page.locator('#wss-properties').isVisible(),false);assert.equal(await page.locator('.wss-block').first().getAttribute('draggable'),'false');
 await page.locator('#wss-preview').click();await page.locator('#wss-save').click();await page.waitForFunction(()=>__calls.filter(c=>c.key==='save_design').length===2);
 await page.locator('#wss-existing').selectOption('');assert.equal(await page.locator('.wss-block').count(),0);assert.equal(await page.locator('#wss-title').inputValue(),'');
 await page.locator('#wss-existing').selectOption('studio-test');await page.waitForFunction(()=>document.querySelectorAll('.wss-block').length===5);
 // Changed scope and unknown keys survive loading and resaving.
 await page.locator('#wss-save').click();await page.waitForFunction(()=>__calls.filter(c=>c.key==='save_design').length===3);assert.equal(await page.evaluate(()=>__saved.scope),'Role');
 // Incomplete components block publishing before a request is sent.
 await page.locator('[data-type="shortcut"]').click();await page.locator('#wss-publish').click();assert.equal(await page.evaluate(()=>__calls.filter(c=>c.key==='publish').length),1);assert.match(await page.locator('#wss-errors').textContent(),/destination/);
 // Installed schema controls disable unsupported nesting and link types.
 assert.deepEqual(errors,[]);
 console.log('PASS browser smoke: four surfaces, pickers, nested order, native drag/drop, preview, reload, scope, validation, save-before-publish');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
