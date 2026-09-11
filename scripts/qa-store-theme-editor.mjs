import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';

const require=createRequire(import.meta.url);
const { chromium }=require(process.env.QA_PLAYWRIGHT_PATH||'playwright');
const base=process.env.QA_BASE_URL||'http://127.0.0.1:4192';
const output='data/store-theme-editor-qa';
await mkdir(output,{recursive:true});

const browser=await chromium.launch({
  headless:true,
  executablePath:process.env.QA_BROWSER_PATH||'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
});
const page=await browser.newPage({viewport:{width:1440,height:960}});
const errors=[];
page.on('pageerror',error=>errors.push(error.message));
page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});

try {
  await page.goto(`${base}/online-store/themes/current/edit`,{waitUntil:'networkidle'});
  await page.getByRole('button',{name:'Add section',exact:true}).click();
  const choices=await page.locator('[data-add-theme-section]').allTextContents();
  if(choices.length!==5)throw Error(`Expected 5 section choices, found ${choices.length}`);
  await page.getByRole('button',{name:/^Collapsible content/}).click();
  await page.getByRole('button',{name:'Add block',exact:true}).click();
  const blocks=page.locator('.theme-custom-editor:not([hidden]) [data-theme-block]');
  await blocks.nth(0).getByRole('textbox',{name:'Question'}).fill('First question');
  await blocks.nth(1).getByRole('textbox',{name:'Question'}).fill('Second question');
  await blocks.nth(1).getByRole('button',{name:'Move block up'}).click();
  if(await blocks.nth(0).getByRole('textbox',{name:'Question'}).inputValue()!=='Second question')throw Error('Block move controls did not reorder the content');
  await blocks.nth(1).dragTo(blocks.nth(0));
  if(await blocks.nth(0).getByRole('textbox',{name:'Question'}).inputValue()!=='First question')throw Error('Dragging a block did not reorder the content');

  await page.getByRole('button',{name:'Theme settings',exact:true}).click();
  await page.locator('[name="themePageWidth"]').evaluate(input=>{
    input.value='1260';
    input.dispatchEvent(new Event('input',{bubbles:true}));
  });
  const previewWidth=await page.locator('#store-website-preview').contentFrame().locator('body').evaluate(body=>body.style.getPropertyValue('--store-page-width'));
  if(previewWidth!=='1260px')throw Error(`Theme setting did not update preview: ${previewWidth}`);

  const desktopOverflow=await page.evaluate(()=>({
    body:document.documentElement.scrollWidth-document.documentElement.clientWidth,
    workspace:document.querySelector('.store-workspace').scrollWidth-document.querySelector('.store-workspace').clientWidth,
  }));
  if(desktopOverflow.body>1||desktopOverflow.workspace>1)throw Error(`Desktop overflow: ${JSON.stringify(desktopOverflow)}`);
  await page.screenshot({path:`${output}/desktop.png`});

  await page.setViewportSize({width:390,height:844});
  await page.getByRole('tab',{name:'Sections'}).click();
  await page.getByRole('button',{name:'Collapsible content',exact:true}).click();
  await page.getByRole('tab',{name:'Settings'}).click();
  if(await page.locator('#store-section-title').textContent()!=='Collapsible content')throw Error('A newly added section cannot be reopened from navigation');
  const mobileOverflow=await page.evaluate(()=>({
    body:document.documentElement.scrollWidth-document.documentElement.clientWidth,
    workspace:document.querySelector('.store-workspace').scrollWidth-document.querySelector('.store-workspace').clientWidth,
    settings:document.querySelector('.store-settings-area').scrollWidth-document.querySelector('.store-settings-area').clientWidth,
  }));
  if(mobileOverflow.body>1||mobileOverflow.workspace>1||mobileOverflow.settings>1)throw Error(`Mobile overflow: ${JSON.stringify(mobileOverflow)}`);
  await page.screenshot({path:`${output}/mobile.png`});

  if(errors.length)throw Error(`Browser errors: ${errors.join(' | ')}`);
  console.log(JSON.stringify({choices:choices.length,previewWidth,desktopOverflow,mobileOverflow,errors},null,2));
} finally {
  await browser.close();
}
