import {chromium} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
await mkdir('screenshots',{recursive:true});
const native=process.argv.includes('--native-gpu');
const gpu=process.argv.includes('--webgpu')||native;
const localBrowser='/tmp/denizinebesi-browser/chrome-linux/chrome';
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||(existsSync(localBrowser)?localBrowser:undefined),args:['--no-sandbox',...(native?['--enable-unsafe-webgpu']:gpu?['--enable-unsafe-webgpu','--use-angle=swiftshader','--use-webgpu-adapter=swiftshader']:['--use-angle=swiftshader','--disable-webgpu'])]});
const page=await browser.newPage({viewport:{width:1200,height:800}});
const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.log('PAGE ERROR',e.message);});page.on('console',m=>{if(m.type()==='error'){errors.push(m.text());console.log('CONSOLE ERROR',m.text());}});
try{
  await page.goto('http://localhost:8080');
  await page.waitForFunction(()=>window.__ocean?.ready,{},{timeout:120000});
  await page.waitForTimeout(2500);
  console.log('BACKEND',await page.locator('#backend').textContent());
  if(gpu&&!await page.evaluate(()=>window.__ocean.renderer.backend.isWebGPUBackend))throw new Error('WebGPU backend was requested but not selected');
  if(gpu)console.log('OCEAN',await page.evaluate(()=>({mode:window.__ocean.ocean.mode,readErrors:window.__ocean.ocean.readErrors,heights:Array.from({length:20},(_,i)=>window.__ocean.ocean.getHeight(i*3,i*2)),adapter:window.__ocean.renderer.backend.device.adapterInfo})));
  if(process.argv.includes('--focus-only')){
    await page.locator('#camera').click();await page.keyboard.down('KeyW');
    await page.waitForFunction(()=>window.__ocean.state.throttle>.2,{},{timeout:30000});await page.keyboard.up('KeyW');
    if(errors.length)throw new Error(errors.join('\n'));console.log('PASS: keyboard propulsion still works after clicking camera');
  }else{
  await page.screenshot({path:gpu?'screenshots/webgpu.png':'screenshots/sunset.png'});
  // Test sound activation, horn, and boat engine revving
  await page.locator('#sound').click();
  await page.waitForTimeout(300);
  if (!await page.evaluate(() => window.__ocean.sound.enabled)) throw new Error('Sound toggle failed');
  await page.keyboard.down('KeyB');
  await page.waitForTimeout(200);
  if (!await page.evaluate(() => window.__ocean.sound.hornActive)) throw new Error('Horn activation failed');
  await page.keyboard.up('KeyB');

  await page.keyboard.down('KeyW');
  await page.waitForTimeout(3000);
  const revving = await page.evaluate(() => ({
    engineHz: window.__ocean.sound.engineHz,
    enabled: window.__ocean.sound.enabled,
  }));
  if (revving.engineHz <= 35) throw new Error('Boat engine Hz did not rise under throttle');

  await page.keyboard.up('KeyW');
  await page.waitForTimeout(300);
  console.log('SOUND TELEMETRY:', revving);

  const driven=await page.evaluate(()=>({...window.__ocean.state}));if(!(driven.speed>0&&driven.z<0))throw new Error('Boat did not move');
  await page.keyboard.down('KeyW');await page.keyboard.down('KeyA');await page.waitForTimeout(1500);await page.keyboard.up('KeyA');await page.keyboard.up('KeyW');
  if(await page.evaluate(()=>window.__ocean.state.heading)<=0)throw new Error('Steering failed');
  await page.locator('[data-hour="0"]').click();await page.waitForTimeout(2000);await page.screenshot({path:gpu?'screenshots/webgpu-night.png':'screenshots/night.png'});
  await page.locator('#vessel').selectOption('ship');await page.waitForTimeout(1000);if(!await page.evaluate(()=>window.__ocean.settings.ship))throw new Error('Ship selection failed');
  await page.locator('#camera').click();await page.waitForTimeout(500);if(await page.evaluate(()=>window.__ocean.settings.camera)!==1)throw new Error('Camera failed');
  await page.locator('#quality').selectOption('low');await page.waitForTimeout(500);
  await page.setViewportSize({width:390,height:844});await page.locator('#settings-toggle').click();await page.screenshot({path:'screenshots/mobile.png'});
  if(errors.length)throw new Error(errors.join('\n'));
  console.log('PASS: rendering, propulsion, steering, night, ship, camera, quality and mobile layout',driven);
  }
}finally{console.log('ERRORS',errors);await browser.close();}
