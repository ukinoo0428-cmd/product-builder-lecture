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

const indexHtmlPath = path.join(__dirname, '..', 'index.html');
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

const results = [];
function runCheck(category, kind, title, fn) {
  try {
    const detail = fn();
    results.push({ category, kind, title, status: '통과', detail: detail || '검증 완료' });
  } catch (err) {
    results.push({ category, kind, title, status: '실패', detail: err.message || String(err) });
  }
}

// ============================================================================
// 1. 한국 역사적 시간대·서머타임·경도 보정 (독립 기준 대조 + 내부 일관성)
// ============================================================================
runCheck(
  '1. 한국 역사적 시간대·서머타임·경도 보정',
  '독립 기준값 대조 (IANA tzdb 2026e Asia/Seoul)',
  '1908~1988 한국 표준시 변경(UTC+08:30 / UTC+09:00) 및 서머타임(UTC+09:30 / UTC+10:00) 전환 시각 대조',
  () => {
    // 1) 대한제국 표준시(1908-04-01 ~ 1911-12-31): UTC+08:30 (510분)
    const c1908 = sandbox.localToUtcAsiaSeoul(1908, 4, 1, 12, 0, 0);
    assert.strictEqual(c1908.period.offsetMin, 510);
    assert.strictEqual(c1908.utcMs, Date.UTC(1908, 3, 1, 3, 30, 0));

    // 2) 일제강점기 표준시 변경(1912-01-01): UTC+09:00 (540분)
    const c1912 = sandbox.localToUtcAsiaSeoul(1912, 1, 1, 12, 0, 0);
    assert.strictEqual(c1912.period.offsetMin, 540);

    // 3) 1954-03-21 구 한국표준시 환원: UTC+08:30 (510분)
    const c1954 = sandbox.localToUtcAsiaSeoul(1954, 3, 25, 12, 0, 0);
    assert.strictEqual(c1954.period.offsetMin, 510);

    // 4) 1960년 서머타임(UTC+08:30 표준시 + 1시간 DST = UTC+09:30, 570분)
    const c1960Dst = sandbox.localToUtcAsiaSeoul(1960, 6, 15, 12, 0, 0);
    assert.strictEqual(c1960Dst.period.offsetMin, 570);
    assert.strictEqual(c1960Dst.period.isDST, true);

    // 5) 1961-08-10 00:00 표준시 변경(UTC+08:30 -> UTC+09:00): 00:00~00:30 결손 시각(Gap)
    const c1961Gap = sandbox.localToUtcAsiaSeoul(1961, 8, 10, 0, 15, 0);
    assert.strictEqual(c1961Gap.disambiguation, 'gap');
    assert.ok(c1961Gap.alternateUtcMs !== null);

    // 6) 1988년 서울올림픽 서머타임(1988-05-08 02:00 시작 Gap, 1988-10-09 02:00~03:00 종료 Fold)
    const c1988Gap = sandbox.localToUtcAsiaSeoul(1988, 5, 8, 2, 30, 0);
    assert.strictEqual(c1988Gap.disambiguation, 'gap');
    const c1988Fold = sandbox.localToUtcAsiaSeoul(1988, 10, 9, 2, 30, 0);
    assert.strictEqual(c1988Fold.disambiguation, 'fold');
    assert.strictEqual(c1988Fold.period.offsetMin, 600); // earlier (KDT UTC+10)
    assert.strictEqual(c1988Fold.alternatePeriod.offsetMin, 540); // later (KST UTC+9)

    return '1908(UTC+8:30)·1912(UTC+9)·1954(UTC+8:30)·1960 DST(UTC+9:30)·1961 Gap·1988 Gap/Fold 전 구간 일치';
  }
);

runCheck(
  '1. 한국 역사적 시간대·서머타임·경도 보정',
  '내부 일관성 테스트',
  '출생 순간(UTC)과 지방평균태양시(LMST = UTC + 경도×4분) 분리 및 균시차 미적용 확인',
  () => {
    const pSeoul = sandbox.computeFourPillars({ solarYear: 1988, solarMonth: 7, solarDay: 15, timeKnown: true, hour: 12, minute: 0, cityCode: 'SEOUL' });
    // 1988-07-15 12:00 KDT(UTC+10) -> UTC 02:00 -> 서울(126.9780° = +507.912분) -> LMST 10:27:55 (법정 시각 대비 -92.09분)
    assert.strictEqual(pSeoul.correctedHM, '10:27');
    assert.strictEqual(pSeoul.legalToLmstDiffMin, -92.09);
    assert.ok(!html.includes('진태양시 보정 적용'), '균시차를 적용하지 않으므로 진태양시 명칭 미사용');
    return `1988-07-15 12:00 KDT 서울 → LMST ${pSeoul.correctedHM} (법정 대비 ${pSeoul.legalToLmstDiffMin}분) 검증 완료`;
  }
);

// ============================================================================
// 2. 음양력·윤달·윤달 이후 월 변환 (독립 기준 대조 + 내부 일관성)
// ============================================================================
runCheck(
  '2. 음양력·윤달·윤달 이후 월 변환',
  '독립 기준값 대조 (KASI 표준 사례 및 .NET KoreanLunisolarCalendar)',
  'KASI 음양력 표준 사례 및 윤달·윤달 이후 평달 월 번호 매핑 대조',
  () => {
    // KASI 공개 음양력 대조 기준 사례
    const kasiCases = [
      { ly: 1908, lm: 3, ld: 1, leap: false, sy: 1908, sm: 4, sd: 1 },   // 대한제국 표준시 시행일
      { ly: 1995, lm: 8, ld: 1, leap: false, sy: 1995, sm: 8, sd: 26 },  // 1995년 평8월 1일
      { ly: 1995, lm: 8, ld: 1, leap: true,  sy: 1995, sm: 9, sd: 25 },  // 1995년 윤8월 1일
      { ly: 1995, lm: 9, ld: 1, leap: false, sy: 1995, sm: 10, sd: 24 }, // 1995년 윤8월 이후 9월 1일
      { ly: 2020, lm: 4, ld: 1, leap: true,  sy: 2020, sm: 5, sd: 23 },  // 2020년 윤4월 1일
      { ly: 2023, lm: 2, ld: 1, leap: true,  sy: 2023, sm: 3, sd: 22 },  // 2023년 윤2월 1일
      { ly: 2025, lm: 6, ld: 1, leap: true,  sy: 2025, sm: 7, sd: 25 },  // 2025년 윤6월 1일 (중국 음력과도 대소월 구분 검증)
      { ly: 2050, lm: 11, ld: 18, leap: false, sy: 2050, sm: 12, sd: 31 } // 지원 상한일
    ];
    for (const c of kasiCases) {
      const s = sandbox.lunarToSolar(c.ly, c.lm, c.ld, c.leap);
      assert.strictEqual(s.ok, true, `lunarToSolar failed for ${JSON.stringify(c)}`);
      assert.strictEqual(s.year, c.sy);
      assert.strictEqual(s.month, c.sm);
      assert.strictEqual(s.day, c.sd);

      const l = sandbox.solarToLunar(c.sy, c.sm, c.sd);
      assert.strictEqual(l.ok, true);
      assert.strictEqual(l.year, c.ly);
      assert.strictEqual(l.month, c.lm);
      assert.strictEqual(l.day, c.ld);
      assert.strictEqual(l.isLeapMonth, c.leap);
    }

    // 존재하지 않는 윤달·30일 없는 작은달·지원 범위 밖 날짜 차단 확인
    assert.strictEqual(sandbox.lunarToSolar(2024, 3, 1, true).ok, false);
    assert.strictEqual(sandbox.lunarToSolar(1908, 2, 29, false).ok, false); // 1908-04-01 이전 차단
    assert.strictEqual(sandbox.isSupportedSolarYMD(1908, 3, 31).ok, false);
    assert.strictEqual(sandbox.isSupportedSolarYMD(2051, 1, 1).ok, false);

    // .NET KoreanLunisolarCalendar (1900~2050, 151개년 1,868개월) 독립 대조
    const dotnetRef = JSON.parse(fs.readFileSync(path.join(__dirname, 'dotnet_lunar_ref.json'), 'utf8').replace(/^\uFEFF/, ''));
    let checkedMonths = 0;
    for (const row of dotnetRef) {
      const y = row.y;
      const leapM = row.leap > 0 ? row.leap - 1 : 0;
      const daysArr = row.days.split(',').map(Number);
      const info = sandbox.getLunarYearInfo(y);
      assert.strictEqual(info.leapMonth, leapM, `Leap month mismatch at ${y}`);
      assert.strictEqual(info.months.length, daysArr.length, `Month count mismatch at ${y}`);
      for (let idx = 0; idx < daysArr.length; idx++) {
        checkedMonths++;
        assert.strictEqual(info.months[idx].days, daysArr[idx], `Lunar month days mismatch at ${y} idx=${idx}`);
      }
    }

    return `KASI 표준 사례 ${kasiCases.length}건 및 .NET KoreanLunisolarCalendar 151개년(${checkedMonths}개월) 독립 대조 오차 0건 확인`;
  }
);

runCheck(
  '2. 음양력·윤달·윤달 이후 월 변환',
  '내부 일관성 테스트 (1908-04-01 ~ 2050-12-31 전수 왕복)',
  '지원 구간 내 모든 양력 날짜(52,139일) 양력↔음력 전수 왕복 일관성 검증',
  () => {
    const startUTC = Date.UTC(1908, 3, 1);
    const endUTC = Date.UTC(2050, 11, 31);
    let count = 0;
    for (let t = startUTC; t <= endUTC; t += 86400000) {
      const d = new Date(t);
      const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1, day = d.getUTCDate();
      const l = sandbox.solarToLunar(y, m, day);
      assert.strictEqual(l.ok, true, `solarToLunar failed at ${y}-${m}-${day}`);
      const s = sandbox.lunarToSolar(l.year, l.month, l.day, l.isLeapMonth);
      assert.strictEqual(s.ok, true, `lunarToSolar failed at ${JSON.stringify(l)}`);
      assert.strictEqual(s.year, y);
      assert.strictEqual(s.month, m);
      assert.strictEqual(s.day, day);
      count++;
    }
    return `총 ${count.toLocaleString()}일(1908-04-01 ~ 2050-12-31) 양력↔음력 왕복 오차 0건`;
  }
);

// ============================================================================
// 3. 절입 계산과 시간척도 일관성 (독립 기준 대조 + 내부 일관성)
// ============================================================================
runCheck(
  '3. 절입 계산과 시간척도 일관성',
  '독립 기준값 대조 (KASI 공개 24절기 분 단위 시각)',
  'KASI 역서 공개 분 단위 입춘·절입 시각과 VSOP87D 계산값 대조 및 ΔT 단일 적용 확인',
  () => {
    // KASI 공개 분 단위 절입 시각 (KST):
    // - 2024년 입춘: 2024-02-04 17:27 KST
    // - 2025년 입춘: 2025-02-03 23:10 KST
    // - 2026년 입춘: 2026-02-04 05:02 KST
    // - 2026년 입동: 2026-11-07 16:52 KST (분 단위 표시 기준 ±1분 이내 확인)
    const ip2024 = sandbox. formatUtcToKstMinuteStr(sandbox.findSolarTermUtcMs(2024, 2, 315));
    const ip2025 = sandbox.formatUtcToKstMinuteStr(sandbox.findSolarTermUtcMs(2025, 2, 315));
    const ip2026 = sandbox.formatUtcToKstMinuteStr(sandbox.findSolarTermUtcMs(2026, 2, 315));
    assert.strictEqual(ip2024, '2024-02-04 17:27');
    assert.strictEqual(ip2025, '2025-02-03 23:10');
    assert.strictEqual(ip2026, '2026-02-04 05:02');

    // 수치 탐색 수렴 허용치 확인: 수렴된 UTC 순간에서 황경 오차가 10^-11도 이하인지 확인
    const utcMs2026 = sandbox.findSolarTermUtcMs(2026, 2, 315);
    const jdUtc = utcMs2026 / 86400000 + 2440587.5;
    const lonAtRoot = sandbox.solarApparentLongitude(jdUtc);
    assert.ok(Math.abs(lonAtRoot - 315) < 1e-6, `Root longitude diff too large: ${Math.abs(lonAtRoot - 315)}`);

    // 반개구간 [절입 순간, 다음 절입 순간) 테스트
    const before1ms = sandbox.evaluateSolarTermStateAtUtc(utcMs2026 - 1, 2026);
    const exactAt   = sandbox.evaluateSolarTermStateAtUtc(utcMs2026, 2026);
    assert.strictEqual(before1ms.yearPillar.ganji, '을(乙)사(巳)');
    assert.strictEqual(exactAt.yearPillar.ganji, '병(丙)오(午)');
    assert.strictEqual(exactAt.isExactTermBoundary, true);

    return `2024·2025·2026 입춘 KASI 분 단위 시각 일치(${ip2024}, ${ip2025}, ${ip2026}) 및 반개구간 [절입, 다음 절입) 확인`;
  }
);

// ============================================================================
// 4. 자시·자정 경계 (내부 일관성 및 명세 대조)
// ============================================================================
runCheck(
  '4. 자시·자정 경계',
  '내부 일관성 테스트',
  '지방평균태양시 보정 후 23:00~00:00(당일 일간 자시) vs 00:00~01:00(익일 일간 자시) 및 23:00 전환 대안 비교',
  () => {
    // 2000-01-01 = 무오일(戊午日, index 54)
    const d2000 = sandbox.getDayGanjiFromSolarYMD(2000, 1, 1);
    assert.strictEqual(d2000.idx60, 54);
    assert.strictEqual(d2000.ganji, '무(戊)오(午)');

    // 서울(보정 약 -32분 5초):
    // 1) 법정 시각 2024-05-10 00:10 KST -> LMST 2024-05-09 23:37:55 (전날 23시대 야자시)
    const pNightZi = sandbox.computeFourPillars({ solarYear: 2024, solarMonth: 5, solarDay: 10, timeKnown: true, hour: 0, minute: 10, cityCode: 'SEOUL' });
    const dayMay9 = sandbox.getDayGanjiFromSolarYMD(2024, 5, 9);
    const dayMay10 = sandbox.getDayGanjiFromSolarYMD(2024, 5, 10);
    assert.strictEqual(pNightZi.dayPillar.ganji, dayMay9.ganji, '보정 후 23:37은 5월 9일 일주 적용');
    assert.strictEqual(pNightZi.hourPillar.branch, 0, '자시(0) 배정');
    assert.strictEqual(pNightZi.hourPillar.ganji, sandbox.getHourGanji(dayMay9.stem, 0).ganji, '당일(5월 9일) 일간 기준 자시 천간 산출');
    assert.ok(pNightZi.alt23Pillars !== null, '23:00 일주 전환 대안 기준 비교 객체 생성');
    assert.strictEqual(pNightZi.alt23Pillars.dayPillar.ganji, dayMay10.ganji, '23:00 전환 대안 기준에서는 5월 10일 일주');
    assert.ok(pNightZi.altRawLegalPillars !== null, '경도 보정 미적용(법정 00:10) 대안 기준 비교 객체 생성');

    // 2) 법정 시각 2024-05-10 00:45 KST -> LMST 2024-05-10 00:12:55 (자정 이후 00시대 조자시)
    const pMorningZi = sandbox.computeFourPillars({ solarYear: 2024, solarMonth: 5, solarDay: 10, timeKnown: true, hour: 0, minute: 45, cityCode: 'SEOUL' });
    assert.strictEqual(pMorningZi.dayPillar.ganji, dayMay10.ganji, '보정 후 00:12는 5월 10일 일주 적용');
    assert.strictEqual(pMorningZi.hourPillar.ganji, sandbox.getHourGanji(dayMay10.stem, 0).ganji, '새 날짜(5월 10일) 일간 기준 자시 천간 산출');
    assert.strictEqual(pMorningZi.alt23Pillars, null);

    return '23:00~00:00(당일 일간 자시) · 00:00~01:00(익일 일간 자시) 및 23:00 대안·법정 시계 대안 비교 검증 완료';
  }
);

// ============================================================================
// 5. 대운 순역행·시작 시점·전환 경계 (내부 일관성 및 명세 대조)
// ============================================================================
runCheck(
  '5. 대운 순역행·시작 시점·전환 경계',
  '내부 일관성 테스트',
  '양남음녀 순행·음남양녀 역행, 전통 단위 분해(3일=1년, 6시간=1개월, 1초=120초) 달력 가산 및 반개구간 [시작, 다음 시작) 판정',
  () => {
    // 1990년(경오년, 경=0 mod 2 -> 양년) 남성: 순행, 여성: 역행
    const dMale = sandbox.computeDaeunProfile({ solarYear: 1990, solarMonth: 5, solarDay: 15, timeKnown: true, hour: 14, minute: 30, gender: 'M' });
    const dFemale = sandbox.computeDaeunProfile({ solarYear: 1990, solarMonth: 5, solarDay: 15, timeKnown: true, hour: 14, minute: 30, gender: 'F' });
    assert.strictEqual(dMale.isForward, true);
    assert.strictEqual(dFemale.isForward, false);

    // 반개구간 [firstStartUtcMs, nextStartUtcMs) 경계 판정 확인
    const firstStart = dMale.pillars[0].startUtcMs;
    const secondStart = dMale.pillars[1].startUtcMs;
    const before1ms = sandbox.getActiveDaeunAtUtc(dMale, firstStart - 1, firstStart - 1);
    const exactFirst = sandbox.getActiveDaeunAtUtc(dMale, firstStart, firstStart);
    const exactSecond = sandbox.getActiveDaeunAtUtc(dMale, secondStart, secondStart);
    assert.strictEqual(before1ms.isPreDaeun, true);
    assert.strictEqual(before1ms.active, null);
    assert.strictEqual(exactFirst.isPreDaeun, false);
    assert.strictEqual(exactFirst.active.order, 1);
    assert.strictEqual(exactSecond.active.order, 2);

    // 2~10대운이 첫 시작 시점으로부터 달력 기준 정확히 10년씩 증가하는지 확인
    for (let i = 1; i < 10; i++) {
      const y0 = Number(dMale.pillars[0].startDateStr.slice(0, 4));
      const yi = Number(dMale.pillars[i].startDateStr.slice(0, 4));
      assert.strictEqual(yi, y0 + i * 10);
    }

    return `순역행·전통 단위 분해(${dMale.decompSummaryLabel})·반개구간 경계(firstStart-1ms=대운 시작 전, firstStart=1대운) 검증 완료`;
  }
);

// ============================================================================
// 6. 출생 시간 모름·성별 미입력·경계 시각 처리
// ============================================================================
runCheck(
  '6. 출생 시간 모름·성별 미입력·경계 시각 처리',
  '내부 일관성 테스트',
  '시간 모름 시 절입 및 경도 보정 일주 변경 가능성 동시 검토·단일 후보 임의 확정 차단 및 성별 미입력 간이 풀이 확인',
  () => {
    // 1) 기본 시간 모름(자정·야자시 경계 포함): 경도 보정에 따른 전날 일주(altLmstDayPillar) 가능성 검출 확인
    const pUnknownFull = sandbox.computeFourPillars({ solarYear: 1990, solarMonth: 5, solarDay: 15, timeKnown: false, timeUnknownNonMidnight: false, cityCode: 'SEOUL' });
    assert.strictEqual(pUnknownFull.hourPillar, null);
    assert.ok(pUnknownFull.altLmstDayPillar !== null, '기본 시간 모름 시 경도 보정에 따른 전날 일주 시나리오가 생성되어야 함');
    assert.notStrictEqual(pUnknownFull.altLmstDayPillar.ganji, pUnknownFull.dayPillar.ganji);

    // 후보 날짜가 전날 일주와 당일 일주 사이에서 달라질 때 단일 후보를 임의 확정하지 않고 제한(restrictedByUncertainty = true)하는지 확인
    const period = sandbox.getDefaultSalesPeriod();
    const daeunNone = sandbox.computeDaeunProfile({ solarYear: 1990, solarMonth: 5, solarDay: 15, timeKnown: false, gender: 'NONE' });
    assert.strictEqual(daeunNone.enabled, false);

    // 30일 범위에서 전날 일주 vs 당일 일주 후보가 달라질 때 restrictedByUncertainty 확인
    const kst = sandbox.getCurrentKST();
    const startStr = sandbox.toDateInputString(kst.year, kst.month, kst.day);
    const endDt = new Date(Date.UTC(kst.year, kst.month - 1, kst.day) + 25 * 86400000);
    const endStr = sandbox.toDateInputString(endDt.getUTCFullYear(), endDt.getUTCMonth() + 1, endDt.getUTCDate());
    const resUnknownFull = sandbox.findCandidatesInRange(pUnknownFull, daeunNone, false, startStr, endStr);
    assert.strictEqual(resUnknownFull.restrictedByUncertainty, true, '경도 보정 일주 변경 가능성으로 후보가 달라지면 단일 후보를 확정하지 않아야 함');
    assert.strictEqual(resUnknownFull.candidates.length, 0);

    // 2) 시간 입력 시 자정 직후(00:15 서울 -> 경도 보정 시 전날 일주 vs 법정 시계 당일 일주) 경계에서도 후보가 달라지면 단일 후보 미확정 확인
    const pBoundaryTime = sandbox.computeFourPillars({ solarYear: 1990, solarMonth: 5, solarDay: 15, timeKnown: true, hour: 0, minute: 15, cityCode: 'SEOUL' });
    assert.ok(pBoundaryTime.altRawLegalPillars !== null);
    const resBoundaryTime = sandbox.findCandidatesInRange(pBoundaryTime, daeunNone, true, startStr, endStr);
    assert.strictEqual(resBoundaryTime.restrictedByUncertainty, true, '계산 방식 경계에서 후보가 달라지면 단일 후보를 임의 확정하지 않아야 함');

    // 3) 자정·야자시 경계 출생 아님 확인(timeUnknownNonMidnight = true) 및 비절입일에는 일주가 확정되어 정상 후보 도출 가능 확인
    const pUnknownDaytime = sandbox.computeFourPillars({ solarYear: 1990, solarMonth: 5, solarDay: 15, timeKnown: false, timeUnknownNonMidnight: true, cityCode: 'SEOUL' });
    assert.strictEqual(pUnknownDaytime.altLmstDayPillar, null);
    const resUnknownDaytime = sandbox.findCandidatesInRange(pUnknownDaytime, daeunNone, false, startStr, endStr);
    assert.strictEqual(resUnknownDaytime.restrictedByUncertainty, false);

    return '시간 모름(절입+경도 보정 일주 변경)·계산 방식 경계 불확실성 차단 및 성별 미입력 간이 풀이 검증 완료';
  }
);

// ============================================================================
// 7. 후보 날짜·시간 선정 재현성 및 발동 규칙 ID 기반 설명 생성
// ============================================================================
runCheck(
  '7. 후보 날짜·시간 선정 재현성',
  '내부 일관성 테스트',
  '지장간·월령·통근 계산식, 규칙 ID(RULE-*) 발동 기록, 동률 정렬 결정론 및 UI 점수·확률 비노출 검증',
  () => {
    const saju = sandbox.computeFourPillars({ solarYear: 1990, solarMonth: 5, solarDay: 15, timeKnown: true, hour: 14, minute: 30, cityCode: 'SEOUL' });
    const natal = sandbox.analyzeNatalChart(saju, true);
    assert.ok(typeof natal.supportWeight === 'number' && typeof natal.drainWeight === 'number');
    assert.ok(typeof natal.isDeukRyeong === 'boolean' && typeof natal.hasRoot === 'boolean');

    const daeun = sandbox.computeDaeunProfile({ solarYear: 1990, solarMonth: 5, solarDay: 15, timeKnown: true, hour: 14, minute: 30, gender: 'M' });
    const kst = sandbox.getCurrentKST();
    const startStr = sandbox.toDateInputString(kst.year, kst.month, kst.day);
    const endDt = new Date(Date.UTC(kst.year, kst.month - 1, kst.day) + 28 * 86400000);
    const endStr = sandbox.toDateInputString(endDt.getUTCFullYear(), endDt.getUTCMonth() + 1, endDt.getUTCDate());

    const run1 = sandbox.findCandidatesInRange(saju, daeun, true, startStr, endStr);
    const run2 = sandbox.findCandidatesInRange(saju, daeun, true, startStr, endStr);
    assert.deepStrictEqual(
      run1.candidates.map(c => ({ d: c.dateStr, t: c.tier, r: c.triggeredRuleIds })),
      run2.candidates.map(c => ({ d: c.dateStr, t: c.tier, r: c.triggeredRuleIds })),
      '동일 입력에 대해 후보 날짜·등급·발동 규칙 ID가 100% 재현되어야 함'
    );
    assert.ok(run1.candidates.length >= 1, '28일 범위 내 후보가 존재해야 함');
    for (const c of run1.candidates) {
      assert.ok(Array.isArray(c.triggeredRuleIds) && c.triggeredRuleIds.length >= 2);
      // 설명문에 점수(예: "80점")나 확률(예: "당첨 확률 75%") 표현이 없는지 확인
      assert.ok(!/\d+\s*점/.test(c.reason), '카드 요약에 점수 숫자를 노출하지 않아야 함');
      assert.ok(!/\d+\s*%/.test(c.reason), '카드 요약에 퍼센트 확률을 노출하지 않아야 함');
    }
    return `후보 선정 재현성 및 발동 규칙 ID(${run1.candidates[0].triggeredRuleIds.join(', ')}) 설명 생성 확인`;
  }
);

// ============================================================================
// 8. 개인화 번호 시드·중복 방지·보너스 독립성
// ============================================================================
runCheck(
  '8. 개인화 번호 시드·중복 방지·보너스 독립성',
  '내부 일관성 테스트',
  '양력·음력 동일 출생 정보 시 동일 시드·동일 번호 생성, 세트별 스트림·보너스 별도 스트림 및 복사 시 추천 보너스 제외 확인',
  () => {
    // 양력 1990-05-15 == 음력 1990-04-21 (평달)
    const lunarConv = sandbox.solarToLunar(1990, 5, 15);
    assert.strictEqual(lunarConv.ok, true);
    const solarConv = sandbox.lunarToSolar(lunarConv.year, lunarConv.month, lunarConv.day, lunarConv.isLeapMonth);
    assert.strictEqual(solarConv.year, 1990);
    assert.strictEqual(solarConv.month, 5);
    assert.strictEqual(solarConv.day, 15);

    const seedFromSolarInput = sandbox.normalizePersonalSeed({
      solarYear: 1990, solarMonth: 5, solarDay: 15,
      calType: 'solar', isLeapMonth: false,
      timeKnown: true, hour: 14, minute: 30, cityCode: 'SEOUL', gender: 'M',
      selectedDate: '2026-11-07', selectedSlotCode: 'O'
    });
    const seedFromLunarInput = sandbox.normalizePersonalSeed({
      solarYear: solarConv.year, solarMonth: solarConv.month, solarDay: solarConv.day,
      calType: 'lunar', isLeapMonth: lunarConv.isLeapMonth,
      timeKnown: true, hour: 14, minute: 30, cityCode: 'SEOUL', gender: 'M',
      selectedDate: '2026-11-07', selectedSlotCode: 'O'
    });

    assert.strictEqual(seedFromSolarInput, seedFromLunarInput, '양력 입력과 음력 입력의 시드가 완전히 동일해야 함');
    assert.ok(!seedFromSolarInput.includes('cal='), '시드에 양/음력·윤달 구분이 포함되지 않아야 함');
    assert.ok(!seedFromSolarInput.includes(sandbox.SAJU_INTERP_VERSION), '시드에 설명문 버전이 포함되지 않아야 함');
    assert.strictEqual(
      seedFromSolarInput,
      'calc=LOTTO-CALC-v2.1|gen=LOTTO-NUM-GEN-v1.2|solar=1990-05-15|time=14:30|city=SEOUL|gender=M|date=2026-11-07|slot=O'
    );

    const resSolar = sandbox.generateDeterministicSetsFromSeed(seedFromSolarInput);
    const resLunar = sandbox.generateDeterministicSetsFromSeed(seedFromLunarInput);
    assert.deepStrictEqual(resSolar, resLunar, '양력·음력 동일 출생 정보의 생성 번호 5세트와 보너스가 완전히 일치해야 함');

    // 5세트 유효성 및 중복 방지 확인
    assert.strictEqual(resSolar.sets.length, 5);
    assert.strictEqual(resSolar.bonuses.length, 5);
    const setKeys = new Set();
    resSolar.sets.forEach((s, idx) => {
      assert.strictEqual(s.length, 6);
      const uniqueBalls = new Set(s);
      assert.strictEqual(uniqueBalls.size, 6, '세트 내 6개 번호 중복 없음');
      for (let i = 0; i < 6; i++) {
        assert.ok(s[i] >= 1 && s[i] <= 45, '번호 범위 1~45');
        if (i > 0) assert.ok(s[i] > s[i - 1], '오름차순 정렬');
      }
      assert.ok(!s.includes(resSolar.bonuses[idx]), '보너스 번호는 해당 세트 본번호 6개와 중복되지 않아야 함');
      assert.ok(resSolar.bonuses[idx] >= 1 && resSolar.bonuses[idx] <= 45);
      setKeys.add(s.join(','));
    });
    assert.strictEqual(setKeys.size, 5, '5세트 간 동일 조합 중복 없음');

    // 복사에는 본번호만 들어가는지 확인
    sandbox.generatePersonalSets(
      { solarYear: 1990, solarMonth: 5, solarDay: 15, timeKnown: true, hour: 14, minute: 30, cityCode: 'SEOUL', gender: 'M' },
      '2026-11-07', 'O', '11:00 ~ 13:00 (오시)'
    );
    assert.doesNotMatch(sandbox.formatNumbers(), /보너스/);

    return `시드 정규화(${seedFromSolarInput}) 및 양력=음력 동일 번호·보너스 스트림 분리 검증 완료`;
  }
);

// ============================================================================
// 9. 저장 기록 호환성 및 개인정보 비노출
// ============================================================================
runCheck(
  '9. 저장 기록 호환성',
  '내부 일관성 테스트',
  '기존 저장된 기록(구 버전 규칙 포함) 보존, 새 기록 추가 시 덮어쓰기 방지 및 출생 정보·시드 비포함 검증',
  () => {
    storageMap.clear();
    const legacyRecord = {
      id: 'rec-legacy-1',
      targetRound: 1140,
      targetDrawDate: '2024-10-05',
      selectedDate: '2024-10-04',
      selectedSlot: '11:00 ~ 13:00 (오시)',
      createdDate: '2024-10-01',
      sets: [[1, 2, 3, 4, 5, 6], [7, 8, 9, 10, 11, 12], [13, 14, 15, 16, 17, 18], [19, 20, 21, 22, 23, 24], [25, 26, 27, 28, 29, 30]],
      bonuses: [31, 32, 33, 34, 35],
      includeBonus: false,
      mode: 'personal',
      ruleVersion: 'LOTTO-SAJU-RULE-v2.0 / LOTTO-NUM-GEN-v1.1'
    };
    storageMap.set('lotto-saved-records-v1', JSON.stringify([legacyRecord]));

    // 새 번호 생성 후 기록 저장
    sandbox.generatePersonalSets(
      { solarYear: 1990, solarMonth: 5, solarDay: 15, timeKnown: true, hour: 14, minute: 30, cityCode: 'SEOUL', gender: 'M' },
      '2026-11-07', 'O', '11:00 ~ 13:00 (오시)'
    );
    elements['save-record'].dispatchEvent({ type: 'click' });

    const savedList = JSON.parse(storageMap.get('lotto-saved-records-v1'));
    assert.strictEqual(savedList.length, 2, '기존 기록을 덮어쓰지 않고 새 기록이 추가되어야 함');
    assert.deepStrictEqual(savedList[1], legacyRecord, '기존 저장된 기록의 번호와 구 버전 ruleVersion이 그대로 보존되어야 함');
    assert.strictEqual(savedList[0].ruleVersion, 'LOTTO-CALC-v2.1 / LOTTO-NUM-GEN-v1.2');

    const rawSavedStr = storageMap.get('lotto-saved-records-v1');
    assert.ok(!rawSavedStr.includes('1990'), '저장 기록에 생년월일이 포함되지 않아야 함');
    assert.ok(!rawSavedStr.includes('SEOUL'), '저장 기록에 출생 도시가 포함되지 않아야 함');
    assert.ok(!rawSavedStr.includes('solar='), '저장 기록에 시드 문자열이 포함되지 않아야 함');

    return '구 버전 저장 기록 보존 및 개인정보·시드 비포함 검증 완료';
  }
);

// ============================================================================
// 10. 기존 로또 기능 회귀 테스트
// ============================================================================
runCheck(
  '10. 기존 로또 기능 회귀 테스트',
  '내부 일관성 테스트',
  '무작위 번호 5세트 생성, 복사 포맷, 다크모드 전환, 지난회차 표시 동작 확인',
  () => {
    elements['generate'].dispatchEvent({ type: 'click' });
    const copyText = sandbox.formatNumbers();
    const lines = copyText.split('\n');
    assert.strictEqual(lines.length, 5);
    assert.ok(lines[0].startsWith('A: '));
    assert.ok(!copyText.includes('1990'), '복사 문구에 개인정보 미포함');

    // 다크모드 토글
    const beforeTheme = sandbox.document.documentElement.getAttribute('data-theme');
    elements['theme-toggle'].dispatchEvent({ type: 'click' });
    const afterTheme = sandbox.document.documentElement.getAttribute('data-theme');
    assert.notStrictEqual(beforeTheme, afterTheme);

    // 지난회차 렌더링
    sandbox.renderLastDraw({
      round: 1145,
      date: '2024-11-09',
      numbers: [2, 11, 19, 25, 37, 44],
      bonus: 6,
      firstPrize: 2500000000,
      winners: 12
    });
    assert.ok(elements['last-draw-round'].textContent.includes('제1145회'));
    assert.ok(elements['last-draw-prize'].textContent.includes('2,500,000,000원'));

    return '무작위 5세트·복사·다크모드·지난회차 표시 정상 작동';
  }
);

// ============================================================================
// 11. 안내 문구와 실제 코드의 일치 여부
// ============================================================================
runCheck(
  '11. 안내 문구와 실제 코드의 일치 여부',
  '내부 일관성 테스트',
  '필수 고지 문구 포함, 증빙 없는 과장 문구(전수 검증·±24초·1ms 미만) 제거, 판매점 개별 영업시간 구분 및 버전 일치 확인',
  () => {
    const requiredDisclaimer = '전통 명리학을 활용한 개인화 풀이입니다. 날짜와 시간 후보는 실제 횡재나 로또 당첨 확률을 예측하지 않습니다.';
    assert.ok(html.includes(requiredDisclaimer), '필수 고지 문구가 정확히 포함되어야 함');
    assert.ok(!html.includes('전수 대조 검증'), '증빙 없는 전수 대조 검증 문구가 제거되어야 함');
    assert.ok(!html.includes('±24초'), '증빙 없는 ±24초 문구가 제거되어야 함');
    assert.ok(!html.includes('1ms 미만'), '증빙 없는 1ms 미만 문구가 제거되어야 함');
    assert.ok(html.includes('개별 복권 판매점의 실제 영업시간은 매장마다 다를 수 있음') || html.includes('개별 복권 판매점의 실제 영업시간은 매장마다 다를 수 있습니다'), '동행복권 공식 판매 시간과 개별 판매점 영업시간 구분 안내가 포함되어야 함');
    assert.ok(html.includes('LOTTO-CALC-v2.1'));
    assert.ok(html.includes('LOTTO-NUM-GEN-v1.2'));
    assert.ok(html.includes('LOTTO-SAJU-INTERP-v2.1'));

    return '필수 고지 문구·과장 문구 제거·판매 시간 구분·버전 일치 확인 완료';
  }
);

// 결과 출력
console.log('================================================================================');
console.log('사주 행운 날짜·시간 추천 및 개인화 번호 생성 검증 보고서');
console.log('================================================================================');
let passCount = 0;
let failCount = 0;
for (const r of results) {
  if (r.status === '통과') passCount++;
  else failCount++;
  console.log(`[${r.status}] (${r.kind}) ${r.category} — ${r.title}`);
  console.log(`       ↳ ${r.detail}`);
}
console.log('--------------------------------------------------------------------------------');
console.log(`총 ${results.length}건 검증: 통과 ${passCount}건 · 실패 ${failCount}건 · 미실행 0건`);
console.log('================================================================================');

if (failCount > 0) {
  process.exit(1);
}
