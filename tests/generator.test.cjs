const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const source = readFileSync(require('node:path').join(__dirname, '../generator.js'), 'utf8');

function app({ endpoint = '', fetch = async () => { throw Error('Unexpected request'); }, timeout = 5000 } = {}) {
  const values = { vehType: 'Petrol', vehNo: 'TEST123', custName: 'Example', fromDate: '2025-01-01', toDate: '2025-01-03', fuelRangeStart: '10', fuelRangeEnd: '10', city: 'City', state: 'State' };
  const elements = Object.fromEntries(Object.entries(values).map(([id, value]) => [id, { value, addEventListener() {} }]));
  elements.generateBtn = { textContent: 'Generate Receipts', addEventListener() {} };
  elements.receipts = { innerHTML: '' };
  const alerts = [];
  const context = vm.createContext({
    document: { getElementById: id => elements[id], querySelector: selector => selector.startsWith('meta') ? { content: endpoint } : {} },
    window: { location: { href: 'http://localhost/receipt.html', origin: 'http://localhost' } },
    URL, URLSearchParams, AbortController, fetch,
    setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, timeout)), clearTimeout,
    alert: message => alerts.push(message), console: { warn() {} }
  });
  vm.runInContext(source, context);
  return { elements, alerts, run: code => vm.runInContext(code, context) };
}

test('strict dates support early years and reject impossible dates', () => {
  const a = app();
  for (const value of ['2025-02-29', '2025-13-01', '0000-01-01', '10000-01-01', 'bad']) {
    assert.equal(a.run(`parseDateInput(${JSON.stringify(value)})`), null);
  }
  assert.equal(a.run('formatISODate(parseDateInput("0099-01-01"))'), '0099-01-01');
  assert.equal(a.run('dayNumber(parseDateInput("0100-01-01"))-dayNumber(parseDateInput("0099-12-31"))'), 1);
  assert.equal(a.run('dateRangeInclusive(parseDateInput("2024-02-28"),parseDateInput("2024-03-01")).length'), 3);
});

test('all products generate three receipts with correct units and fixed decimals', async () => {
  for (const [fuel, unit, amount] of [['Petrol','LTR','943.10'],['Diesel','LTR','868.80'],['CNG','KG','761.50'],['EV','kWh','120.00']]) {
    const a = app(); a.elements.vehType.value = fuel;
    await a.run('generateReceipts()');
    const html = a.elements.receipts.innerHTML;
    assert.equal((html.match(/class="receipt"/g) || []).length, 3);
    assert.ok(html.includes(`RATE/${unit}`));
    assert.ok(html.includes(`AMOUNT: ₹ ${amount}`));
    assert.ok(html.includes(`QUANTITY(${unit}): 10.00`));
    assert.ok(html.includes('Built-in sample schedule'));
  }
});

test('invalid ranges and quantities leave existing receipts intact', async () => {
  for (const changes of [
    {fromDate:'2025-01-04'}, {fromDate:'2025-02-30'}, {fromDate:'2024-01-01'},
    {fuelRangeStart:'0.001'}, {fuelRangeStart:'1.001'}, {fuelRangeStart:'21'},
    {fuelRangeEnd:'1000001'}, {fuelRangeStart:''}, {fuelRangeStart:'12oops'}
  ]) {
    const a = app(); a.elements.receipts.innerHTML = 'previous';
    for (const [key,value] of Object.entries(changes)) a.elements[key].value = value;
    await a.run('generateReceipts()');
    assert.equal(a.alerts.length, 1, JSON.stringify(changes));
    assert.equal(a.elements.receipts.innerHTML, 'previous');
  }
});

test('366 days are allowed and user markup is escaped', async () => {
  const a = app(); a.elements.fromDate.value='2024-01-01'; a.elements.toDate.value='2024-12-31';
  a.elements.custName.value='<img src=x onerror=alert(1)>';
  await a.run('generateReceipts()');
  assert.equal((a.elements.receipts.innerHTML.match(/class="receipt"/g)||[]).length,366);
  assert.ok(a.elements.receipts.innerHTML.includes('&lt;img'));
  assert.ok(!a.elements.receipts.innerHTML.includes('<img src=x'));
});

test('API concurrency is bounded, query configuration preserved, and successful rates cached', async () => {
  let active=0, peak=0, calls=0;
  const a=app({endpoint:'/api/fuel-prices?region=in',fetch:async url=>{
    assert.equal(url.searchParams.get('region'),'in');
    calls++; peak=Math.max(peak,++active);
    await new Promise(resolve=>setTimeout(resolve,5)); active--;
    return {ok:true,json:async()=>({rate:100})};
  }});
  a.elements.toDate.value='2025-01-10';
  await a.run('generateReceipts()');
  assert.equal(calls,10); assert.equal(peak,4);
  assert.ok(a.elements.receipts.innerHTML.includes('Rate Source: Fuel API'));
  await a.run('generateReceipts()'); assert.equal(calls,10);
});

test('invalid API responses fall back and can be retried', async () => {
  for(const payload of [null,{}, {rate:0}, {rate:-1}, {rate:Infinity}, {rate:'100'}, {rate:0.001}, {rate:1e30}]) {
    let calls=0;
    const a=app({endpoint:'/api/fuel-prices',fetch:async()=>({ok:true,json:async()=>++calls===1?payload:{rate:100}})});
    a.elements.toDate.value='2025-01-01';
    await a.run('generateReceipts()'); assert.ok(a.elements.receipts.innerHTML.includes('Built-in sample schedule'));
    await a.run('generateReceipts()'); assert.ok(a.elements.receipts.innerHTML.includes('Rate Source: Fuel API'));
    assert.equal(calls,2);
  }
});

test('HTTP errors and timeout aborts fall back; cross-origin endpoints are not requested', async () => {
  for(const fetch of [async()=>({ok:false,status:500}),async(_url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted'))))]) {
    const a=app({endpoint:'/api/fuel-prices',fetch,timeout:5});
    await a.run('generateReceipts()');
    assert.ok(a.elements.receipts.innerHTML.includes('Built-in sample schedule'));
  }
  let requested=false;
  const a=app({endpoint:'https://other.example/prices',fetch:async()=>{requested=true;}});
  await a.run('generateReceipts()'); assert.equal(requested,false);
});
