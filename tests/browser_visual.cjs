// Visual-designer interactions in real headless Chromium against a mocked Frappe layer.
// Covers resize, undo/redo, inline titles, block tools, keyboard delete, sidebar nesting
// by pointer travel, workspace library drops, icon picker, visibility and audience.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root=path.join(__dirname,'..');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
 try {
  const page=await browser.newPage({viewport:{width:1440,height:1100}}), errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.setContent('<div id="wrapper"><div class="layout-main-section"></div></div>');
  const jquery=process.env.JQUERY_PATH || require.resolve('jquery/dist/jquery.min.js');
  for(const file of [jquery,path.join(__dirname,'frappe_mock.js'),path.join(root,'thinknxg_workspace_studio/public/js/designer_model.js'),path.join(root,'thinknxg_workspace_studio/workspace_studio/page/workspace_studio/workspace_studio.js')])await page.addScriptTag({content:await fs.readFile(file,'utf8')});
  await page.evaluate(css=>window.__designerCss=css,await fs.readFile(path.join(root,'thinknxg_workspace_studio/public/css/workspace_studio.css'),'utf8'));
  await page.evaluate(()=>frappe.pages['workspace-studio'].on_page_load(document.querySelector('#wrapper')));
  await page.waitForSelector('#wss-canvas');
  const fill=async(label,value)=>{const el=page.locator('[data-field="'+label+'"]');await el.fill(value);await el.dispatchEvent('change');};
  const badge=i=>page.locator('.wss-block').nth(i).locator('.wss-col-badge').textContent();
  // A blank title is flagged on the field itself, focused, and fillable from a native Workspace.
  await page.locator('#wss-save').click();await page.waitForFunction(()=>!document.querySelector('#wss-save').disabled);
  assert.equal(await page.locator('#wss-title').getAttribute('aria-invalid'),'true');
  await page.waitForFunction(()=>document.activeElement.id==='wss-title');
  await page.locator('#wss-title').blur();
  await page.locator('#wss-errors').getByRole('button',{name:'Enter title'}).click();
  await page.waitForFunction(()=>document.activeElement.id==='wss-title');
  await page.locator('#wss-target').selectOption('Stock');
  assert.equal(await page.locator('#wss-title').inputValue(),'Stock');
  await page.locator('#wss-target').selectOption('');
  await page.locator('#wss-title').fill('Visual Ops');
  assert.equal(await page.locator('#wss-title').getAttribute('aria-invalid'),'false');
  assert.equal(await page.locator('.wss-desk-head > span:last-child').textContent(),'Visual Ops');
  await page.locator('#wss-module').selectOption('Selling');

  // Resize a chart from 6 to fewer columns by dragging its right edge; undo and redo it.
  await page.locator('[data-type="chart"]').click();await fill('Dashboard Chart','Sales Trends');
  assert.equal(await badge(0),'6/12');
  const handle=await page.locator('.wss-block').first().locator('.wss-resize').boundingBox();
  const pitch=await page.locator('#wss-canvas').evaluate(el=>{const s=getComputedStyle(el);return (el.clientWidth-parseFloat(s.paddingLeft)-parseFloat(s.paddingRight)+parseFloat(s.columnGap))/12;});
  await page.mouse.move(handle.x+6,handle.y+handle.height/2);await page.mouse.down();
  await page.mouse.move(handle.x+6-pitch*3,handle.y+handle.height/2,{steps:6});await page.mouse.up();
  assert.equal(await badge(0),'3/12');
  await page.locator('#wss-undo').click();assert.equal(await badge(0),'6/12');
  await page.locator('#wss-redo').click();assert.equal(await badge(0),'3/12');
  await page.locator('.wss-block').first().click();await page.locator('[data-preset="12"]').click();assert.equal(await badge(0),'12/12');
  await page.locator('.wss-col-cell[data-col="4"]').click();assert.equal(await badge(0),'4/12');

  // Inline title editing writes the same property as the inspector.
  await page.locator('.wss-block').first().locator('.wss-title-text').dblclick();
  await page.keyboard.type('Revenue trend');await page.keyboard.press('Enter');
  assert.equal(await page.locator('.wss-block strong').first().textContent(),'Revenue trend');
  assert.equal(await page.locator('[data-field="Title"]').inputValue(),'Revenue trend');

  // Block tools duplicate; keyboard Delete removes the selected block.
  await page.locator('.wss-block').first().hover();await page.locator('.wss-block').first().locator('[data-act="duplicate"]').click();
  assert.equal(await page.locator('.wss-block').count(),2);
  assert.equal(await page.locator('.wss-block strong').nth(1).textContent(),'Revenue trend (copy)');
  await page.locator('.wss-block').nth(1).focus();await page.keyboard.press('Delete');
  assert.equal(await page.locator('.wss-block').count(),1);
  await page.keyboard.press('Control+z');assert.equal(await page.locator('.wss-block').count(),2);
  await page.keyboard.press('Control+Shift+z');assert.equal(await page.locator('.wss-block').count(),1);

  // Sidebar: dragging a row to the right while dropping nests it, with a live indicator.
  await page.locator('[data-surface="sidebar"]').click();
  assert.match(await page.locator('.wss-inactive').textContent(),/Not managed/);
  await page.locator('[data-type="link"]').click();await fill('Title','Customers');await fill('Destination','Customer');
  await page.locator('[data-type="link-preset"][data-link-type="Workspace"]').click();await fill('Title','Groups');await fill('Destination','Sales');
  const row=await page.locator('.wss-block').nth(1).boundingBox();
  await page.mouse.move(row.x+60,row.y+row.height/2);await page.mouse.down();
  await page.mouse.move(row.x+70,row.y+row.height/2,{steps:3});
  await page.mouse.move(row.x+110,row.y+row.height/2,{steps:6});
  assert.equal(await page.locator('.wss-drop-indicator').isVisible(),true);
  await page.mouse.up();
  assert.equal(await page.locator('.wss-block').nth(1).getAttribute('data-depth'),'1');
  await page.locator('.wss-block').nth(1).click();
  await page.getByRole('button',{name:'Outdent',exact:true}).click();
  assert.equal(await page.locator('.wss-block').nth(1).getAttribute('data-depth'),'0');
  await page.getByRole('button',{name:'Indent',exact:true}).click();
  // Collapsing a parent hides its children on the canvas only.
  await page.locator('.wss-block').first().locator('.wss-twisty').click();
  assert.equal(await page.locator('.wss-block').count(),1);
  await page.locator('.wss-block').first().locator('.wss-twisty').click();

  // Desktop: drag an existing site Workspace from the library, pick an icon, hide it.
  await page.locator('[data-surface="desktop"]').click();
  await page.locator('[data-type="workspace-ref"][data-name="Stock"]').dragTo(page.locator('#wss-canvas'));
  assert.equal(await page.locator('.wss-block strong').first().textContent(),'Stock');
  await page.locator('.wss-block').first().click();
  assert.equal(await page.locator('[data-field="Destination"]').inputValue(),'Stock');
  await page.locator('.wss-icon-current').click();await page.locator('.wss-icon-pop input').fill('stock');
  await page.locator('.wss-icon-option[data-icon="stock"]').first().click();
  assert.match(await page.locator('.wss-icon-current').textContent(),/stock/);
  await page.locator('[data-prop="hidden"]').evaluate(el=>el.click());
  assert.equal(await page.locator('.wss-block').first().evaluate(el=>el.classList.contains('is-hidden')),true);
  // Dock: library drop, then drag the new tile before the first.
  await page.locator('[data-surface="dock"]').click();
  await page.locator('[data-type="workspace-ref"][data-name="Sales"]').click();
  await page.locator('[data-type="workspace-ref"][data-name="Stock"]').click();
  await page.locator('.wss-block').nth(1).dragTo(page.locator('.wss-block').first(),{targetPosition:{x:4,y:20}});
  assert.equal(await page.locator('.wss-block strong').first().textContent(),'Stock');

  // Audience: Role scope with a chosen role is saved alongside the design.
  await page.locator('[data-surface="workspace"]').click();
  await page.locator('#wss-stage').click({position:{x:4,y:4}});
  await page.locator('[data-scope="Role"]').click();
  assert.match(await page.locator('#wss-audience-pill').textContent(),/Role · 0/);
  await fill('Add Role','Sales User');
  assert.equal(await page.locator('.wss-chip[data-target="Sales User"]').count(),1);
  await page.locator('.wss-icon-current').click();await page.locator('.wss-icon-pop input').fill('sell');await page.locator('.wss-icon-option[data-icon="sell"]').first().click();
  await page.locator('#wss-save').click();await page.waitForFunction(()=>__calls.some(c=>c.key==='save_design'));
  const saved=await page.evaluate(()=>__saved);
  assert.equal(saved.scope,'Role');assert.equal(saved.icon,'sell');
  assert.deepEqual(JSON.parse(saved.assignments),[{target_type:'Role',target_name:'Sales User',enabled:1,priority:100}]);
  const layout=JSON.parse(saved.layout),nav=JSON.parse(saved.navigation),dock=JSON.parse(saved.dock);
  assert.equal(layout.components[0].config.col,4);assert.equal(layout.components[0].title,'Revenue trend');
  assert.deepEqual(nav.items.map(x=>[x.label,x.indent]),[['Customers',0],['Groups',1]]);
  assert.deepEqual(dock.desktop_icons[0],{label:'Stock',link_type:'Workspace',link_to:'Stock',icon:'stock',hidden:1});
  assert.deepEqual(dock.entries.map(x=>x.link_to),['Stock','Sales']);
  // Reloading restores audience and icon.
  await page.evaluate(()=>{window.__loadScope='Role';});
  await page.locator('#wss-existing').selectOption('');await page.locator('#wss-existing').selectOption('studio-test');
  await page.waitForFunction(()=>document.querySelectorAll('.wss-chip').length===1);

  // Preview removes editing affordances; device widths constrain the desk.
  await page.locator('#wss-preview').click();
  assert.equal(await page.locator('.wss-block-tools').count(),0);
  assert.equal(await page.locator('.wss-resize').count(),0);
  await page.locator('[data-device="mobile"]').click();
  const width=await page.locator('.wss-desk').evaluate(el=>el.getBoundingClientRect().width);
  assert.ok(width<=391,'mobile preview width '+width);
  assert.deepEqual(errors,[]);
  console.log('PASS browser visual: title guidance, resize, undo/redo, inline title, tools, keyboard, sidebar nesting, library drops, icon picker, visibility, audience, preview devices');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
