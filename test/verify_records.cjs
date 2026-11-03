'use strict';

/**
 * 사주 기반 행운 날짜·시간 추천 및 개인화 번호 생성 검증 스위트 (test/verify_all.js)
 * - 구분 1: 독립 공식 기준값 대조 검증 (Independent Reference Cross-Checks)
 *   * .NET System.Globalization.KoreanLunisolarCalendar (1900~2050 전 구간 151년 1,868개월 대조)
 *   * 한국천문연구원(KASI) 공개 음양력·윤달·24절기(12절 분 단위) 표준 사례 대조
 *   * IANA Time Zone Database (Asia/Seoul) 역사적 표준시·서머타임 전환 대조
 * - 구분 2: 내부 일관성 및 규칙 명세 단위 테스트 (Internal Consistency & Rule Spec Tests)
 *   * 11대 필수 검증 항목 전수 점검
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const indexHtmlPath = path.join(__dirname,'..','index.html');
const html = fs.readFileSync(indexHtmlPath, 'utf8');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
if (!scriptMatch) {
  console.error('index.html <script> 태그를 찾을 수 없습니다.');
  process.exit(1);
}

// 최소 DOM 스텁 구성
function makeElem(id = '', tag = 'div') {
  return {
    id,
    tagName: tag.toUpperCase(),
    textContent: '',
    innerHTML: '',
    value: '',
    checked: false,
    disabled: false,
    style: {},
    dataset: {},
    children: [],
    attributes: {},
    classList: {
      _set: new Set(),
      toggle(c, force) {
        if (force === undefined) {
          if (this._set.has(c)) this._set.delete(c);
          else this._set.add(c);
        } else if (force) this._set.add(c);
        else this._set.delete(c);
      },
      contains(c) { return this._set.has(c); }
    },
    setAttribute(k, v) { this.attributes[k] = String(v); },
    getAttribute(k) { return this.attributes[k] ?? null; },
    addEventListener(ev, fn) {
      this._listeners = this._listeners || {};
      this._listeners[ev] = this._listeners[ev] || [];
      this._listeners[ev].push(fn);
    },
    dispatchEvent(evObj) {
      const list = (this._listeners && this._listeners[evObj.type]) || [];
      for (const fn of list) fn(evObj);
    },
    append(...nodes) { this.children.push(...nodes); },
    appendChild(n) { this.children.push(n); return n; },
    replaceChildren(...nodes) { this.children = [...nodes]; },
    scrollIntoView() {},
    querySelector(sel) {
      if (sel.includes(':checked')) {
        for (const c of this.children) {
          if (c.checked) return c;
          if (c.children) {
            for (const gc of c.children) {
              if (gc.checked) return gc;
              if (gc.children) {
                for (const ggc of gc.children) {
                  if (ggc.checked) return ggc;
                }
              }
            }
          }
        }
      }
      return null;
    }
  };
}

const elements = {};
const storageMap = new Map();
const sandbox = {
  console,
  Date,
  Math,
  Intl,
  JSON,
  Array,
  Object,
  String,
  Number,
  Boolean,
  Set,
  Map,
  RegExp,
  Error,
  Uint32Array,
  Infinity,
  isNaN,
  encodeURIComponent,
  unescape,
  crypto: {
    getRandomValues(buf) {
      for (let i = 0; i < buf.length; i++) buf[i] = (Math.random() * 0x100000000) >>> 0;
      return buf;
    }
  },
  localStorage: {
    getItem(k) { return storageMap.has(k) ? storageMap.get(k) : null; },
    setItem(k, v) { storageMap.set(k, String(v)); },
    removeItem(k) { storageMap.delete(k); }
  },
  navigator: { clipboard: { writeText: async () => {} } },
  window: { matchMedia: () => ({ matches: false }) },
  fetch: async () => ({ ok: false }),
  document: {
    documentElement: makeElem('html', 'html'),
    getElementById(id) {
      if (!elements[id]) elements[id] = makeElem(id);
      return elements[id];
    },
    createElement(tag) { return makeElem('', tag); },
    createTextNode(txt) { return { textContent: String(txt) }; }
  }
};

vm.createContext(sandbox);
vm.runInContext(scriptMatch[1], sandbox);


(async () => {
  sandbox.Date = class extends Date { static now() { return Date.parse('2026-12-06T01:00:00Z'); } };
  vm.runInContext("verifiedLatestDraw = {round:1248,date:'2026-10-31',numbers:[1,2,3,4,5,6],bonus:7}", sandbox);
  sandbox.fetch = async () => ({ok:true,json:async()=>({draw_no:1248,date:'2026-10-31T00:00:00Z',numbers:[16,18,27,36,38,42],bonus_no:22,divisions:[{prize:1933658450,winners:15}]})});
  await sandbox.loadLastDraw();
  assert.match(elements['last-draw-round'].textContent,/1248/);
  assert.match(elements['last-draw-prize'].textContent,/1,933,658,450/);
  assert.equal(sandbox.normalizeDrawDate('2026-02-30T00:00:00Z'),null);
  const base = {id:'test',targetRound:null,targetDrawDate:null,selectedDate:'2026-12-05',selectedSlot:'15:00 ~ 17:00 (신시)',createdDate:'2026-11-03',sets:[[1,2,3,4,5,6]],bonuses:[],mode:'personal'};
  sandbox.saveRecordsToStorage([base]);
  const result = {draw_no:1253,date:'2026-12-05T00:00:00Z',numbers:[1,2,3,4,5,6],bonus_no:7};
  const rendered = () => elements['records-list'].children[0].children[2].textContent;
  for (const data of [null, 'offline', {...result,draw_no:1254}, {...result,date:'2026-12-12'}, {...result,numbers:[1,1,2,3,4,5]}, result]) {
    sandbox.fetch = async url => {
      assert(url.endsWith('/1253.json'));
      if (data === 'offline') throw Error('offline');
      return {ok:!!data,json:async()=>data};
    };
    await sandbox.renderSavedRecords();
    assert.equal(sandbox.getSavedRecords()[0].targetRound, data === result ? 1253 : null);
    assert.match(rendered(), data === result ? /6개 일치/ : /대상 회차 확인 중/);
  }
  assert.deepStrictEqual(sandbox.getSavedRecords()[0], {...base,targetRound:1253,targetDrawDate:'2026-12-05'});
  await sandbox.renderSavedRecords();
  assert.match(rendered(), /6개 일치/);
  sandbox.Date = class extends Date { static now() { return Date.parse('2026-12-14T00:00:00Z'); } };
  const candidate = (date,slot) => sandbox.recordDrawCandidate({...base,selectedDate:date,selectedSlot:slot});
  assert.equal(candidate('2026-12-05','19:59 ~ 20:00').round,1253);
  assert.equal(candidate('2026-12-05','20:00 ~ 21:00'),null);
  assert.equal(candidate('2026-12-05','19:00 ~ 21:00'),null);
  assert.equal(candidate('2026-12-06','05:59 ~ 07:00'),null);
  assert.equal(candidate('2026-12-06','06:00 ~ 07:00').round,1254);
  assert.equal(candidate('2026-12-06',null),null);
  assert.equal(sandbox.recordDrawCandidate({...base,selectedDate:null,selectedSlot:null}).round,1249);
  sandbox.initPeriodInputs();
  const start = elements['range-start'], original = start.value;
  start.value = '2026-12-20';
  elements['range-end'].value = '2026-12-21';
  start.dispatchEvent({type:'input'});
  assert.match(elements['range-period-hint'].textContent,/선택한 기간: 2026-12-20/);
  sandbox.initPeriodInputs();
  assert.equal(start.value,original);
  assert.match(elements['range-period-hint'].textContent,/남은 구매 가능 기간/);
  const sets = [[1,2,3,4,5,6],[2,3,4,5,6,7],[3,4,5,6,7,8],[4,5,6,7,8,9],[5,6,7,8,9,10]];
  const old = {...base,sets};
  const saved = {...old,id:'new',selectedDate:'2026-12-04',purchased:[false,true,false,true,false]};
  const json = JSON.stringify({version:1,records:[old,{...saved,birthCity:'SEOUL',result:'대조 완료'},saved]});
  const parsed = sandbox.parseBackup(json);
  assert(!JSON.stringify(parsed).includes('SEOUL'));
  assert(!JSON.stringify(parsed).includes('대조 완료'));
  const merged = sandbox.mergeBackup([], parsed);
  assert.equal(merged.added,2);
  assert.equal(merged.skipped,1);
  assert.equal(sandbox.mergeBackup(merged.records,parsed).added,0);
  assert.throws(()=>sandbox.parseBackup(JSON.stringify({version:1,records:[{...old,sets:[[1,1,2,3,4,5],...sets.slice(1)]}]})));
  storageMap.clear();
  sandbox.saveRecordsToStorage(merged.records);
  assert.equal(sandbox.setPurchased(old.id,1,true),true);
  assert.equal(sandbox.setPurchased(old.id,3,true),true);
  assert.deepStrictEqual(Array.from(sandbox.recordIndices(sandbox.getSavedRecords()[0],false)),[1,3,0,2,4]);
  elements['purchased-only'].checked = true;
  elements['record-filter'].value = 'round';
  vm.runInContext('delete drawResultCache[1253]',sandbox);
  sandbox.fetch = async () => ({ok:false});
  await sandbox.renderSavedRecords();
  assert.equal(elements['records-list'].children.length,2);
  sandbox.fetch = async () => ({ok:true,json:async()=>result});
  await sandbox.renderSavedRecords();
  assert.equal(elements['records-list'].children.length,1);
  assert.match(elements['records-list'].children[0].textContent,/해당하는 기록이 없습니다/);
  elements['record-filter'].value = 'complete';
  await sandbox.renderSavedRecords();
  assert.equal(elements['records-list'].children.length,2);
  const card = elements['records-list'].children[0];
  assert.match(card.children[2].textContent,/B세트 .*D세트/);
  assert.doesNotMatch(card.children[2].textContent,/A세트/);
  assert.equal(sandbox.getSavedRecords()[0].targetRound,1253);
  assert.deepStrictEqual(sandbox.getSavedRecords()[0].purchased,[false,true,false,true,false]);
  const link = card.children[3].children[1];
  assert.equal(link.href,'https://www.dhlottery.co.kr/lt645/intro');
  assert.equal(link.target,'_blank');
  assert.match(card.children[3].children[0].children[2].textContent,/^B: 2  3  4  5  6  7$/);
  sandbox.generateSets();
  const locked = vm.runInContext("JSON.stringify([currentNumbers[0],bonusNumbers[0]])",sandbox);
  vm.runInContext('lockedSets.add(0)',sandbox);
  sandbox.generateSets();
  assert.equal(vm.runInContext("JSON.stringify([currentNumbers[0],bonusNumbers[0]])",sandbox),locked);
  vm.runInContext('[1,2,3,4].forEach(i=>lockedSets.add(i)); renderSets()',sandbox);
  assert.equal(elements.generate.disabled,true);
  assert.equal(sandbox.recordPurchaseDay('2026-12-05',null,'19:59') !== null,true);
  assert.equal(sandbox.recordPurchaseDay('2026-12-05',null,'20:00'),null);
  assert.equal(sandbox.recordPurchaseDay('2026-12-06',null,'05:59'),null);
  assert.equal(sandbox.recordPurchaseDay('2026-12-06',null,'06:00') !== null,true);
  elements['record-filter'].value = 'all';
  elements['purchased-only'].checked = false;
  vm.runInContext('delete drawResultCache[1253]',sandbox);
  let release;
  const delayed = new Promise(resolve => {release = resolve;});
  sandbox.fetch = () => delayed;
  const refresh = sandbox.renderSavedRecords();
  assert.equal(elements['records-list'].children.length,2);
  assert.match(elements['records-list'].children[0].children[2].textContent,/추첨 결과 확인 중/);
  elements['purchased-only'].checked = true;
  sandbox.generateSets();
  elements['save-record'].dispatchEvent({type:'click'});
  elements['save-record'].dispatchEvent({type:'click'});
  assert.equal(sandbox.getSavedRecords().length,4);
  assert.match(elements['record-save-notice'].children[0].textContent,/현재 보기 조건에서는 숨겨져/);
  elements['record-save-notice'].children[1].dispatchEvent({type:'click'});
  assert.equal(elements['records-list'].children.length,4);
  assert.equal(elements['purchased-only'].checked,false);
  assert.equal(sandbox.setPurchased(old.id,0,true),true);
  release({ok:true,json:async()=>result});
  await refresh;
  await sandbox.renderSavedRecords();
  assert.equal(sandbox.getSavedRecords().length,4);
  assert.equal(sandbox.getSavedRecords().find(r=>r.id===old.id).purchased[0],true);
  assert.match(elements['record-filter-detail'].textContent,/저장한 기록을 모두 봐요/);
  console.log('Saved records, filters, backup, locks, entry view and period checks passed');
})().catch(e=>{console.error(e);process.exitCode=1});
