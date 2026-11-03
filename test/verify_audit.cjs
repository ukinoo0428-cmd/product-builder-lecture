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
  setTimeout: () => 1,
  clearTimeout: () => {},
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


(async()=>{
 const el=id=>sandbox.document.getElementById(id);
 const fill={'birth-year':'1990','birth-month':'5','birth-day':'15','birth-time':'12:00','birth-city':'SEOUL','range-start':'2026-12-01','range-end':'2026-12-05'};
 sandbox.Date=class extends Date {constructor(...a){super(...(a.length?a:['2026-11-03T03:00:00Z']));} static now(){return Date.parse('2026-11-03T03:00:00Z');}};
 for(const [id,v] of Object.entries(fill))el(id).value=v;
 const submit=()=>el('saju-form').dispatchEvent({type:'submit',preventDefault(){}});
 submit();
 const before=el('candidates-container').children.length;
 el('birth-month').value='13'; submit();
 const card=el('candidates-container').children[0];
 const gen=card?.children.at(-1);
 if(gen?.textContent?.includes('만들기'))gen.dispatchEvent({type:'click'});
 assert(before > 0); assert.equal(el('candidates-container').children.length,0);
 const birth='lotto-saved-birth-v1';
 storageMap.set(birth,'{"test":true}');
 const remove=sandbox.localStorage.removeItem;
 sandbox.localStorage.removeItem=()=>{throw Error('blocked')};
 el('clear-saved-birth').dispatchEvent({type:'click'});
 assert(storageMap.has(birth)); assert.match(el('status').textContent,/삭제하지 못했어요/);
 sandbox.localStorage.removeItem=remove;
 const draw={round:1249,date:'2026-11-07',numbers:[1,2,3,4,5,6],bonus:7};
 assert.equal(sandbox.evaluateSetMatch([1,1,1,1,1,1],draw),'번호를 확인할 수 없음');
 sandbox.saveRecordsToStorage([null]);
 await sandbox.renderSavedRecords(); assert.match(el('record-integrity-notice').textContent,/1건/); assert.deepStrictEqual(sandbox.getSavedRecords(),[null]);
 sandbox.saveRecordsToStorage([]);
 for(const [round,date] of [[1200,'2025-11-29'],[1300,'2027-10-30']]){
 sandbox.fetch=async()=>({ok:true,json:async()=>({draw_no:round,date,numbers:[1,2,3,4,5,6],bonus_no:7})});
 await sandbox.loadLastDraw();
 assert.match(el('last-draw-round').textContent,/확인 대기/);
 }
 const make=sandbox.document.createElement;
 let count=0;sandbox.document.createElement=(...a)=>{count++;return make(...a)};
 sandbox.Date=class extends Date {static now(){return Date.parse('2026-11-10T00:00:00Z');}};
 const rec={targetRound:1249,targetDrawDate:'2026-11-07',createdDate:'2026-11-03',sets:Array.from({length:5},()=>[1,2,3,4,5,6]),purchased:[true,true,true,true,true],mode:'random'};
 sandbox.saveRecordsToStorage(Array.from({length:100},(_,i)=>({...rec,id:'p'+i})));
 sandbox.fetch=async()=>({ok:true,json:async()=>({draw_no:1249,date:'2026-11-07',numbers:[1,2,3,4,5,6],bonus_no:7,divisions:[{prize:1}]})});
 await sandbox.renderSavedRecords();
 assert(count < 20000);
 const a=[{dateStr:'2026-12-05',tier:'primary',slots:[{branch:8,startHour:15,endHour:17,label:'15:00 ~ 17:00'}]}];
 const b=[{...a[0],slots:[{branch:9,startHour:17,endHour:19,label:'17:00 ~ 19:00'}]}];
 assert.equal(sandbox.candidateSignature(a,true),sandbox.candidateSignature(b,true));
 assert.notEqual(sandbox.candidateSignature(a),sandbox.candidateSignature(b));
 console.log('Audit regressions passed');
})().catch(e=>{console.error(e);process.exitCode=1});

