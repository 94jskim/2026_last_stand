/* ================================================
   미르니 전리품 상자 시뮬레이터 — simulator.js
   ================================================
   수정 가이드:
   - 가챠 데이터 변경: gacha_data.json
   - 상점 패키지 변경: shop_data.json
   - 천장 한도 변경:   아래 PITY_LIMIT 객체
   ================================================ */


/* ──────────────────────────────────────────────
   § 1. 앱 상태 (App State)
   ────────────────────────────────────────────── */

let gachaData = null;   // gacha_data.json 로드 결과
let shopData = null;   // shop_data.json  로드 결과

// 상자 보유 재고
const boxInventory = { '파편': 0, '조각': 0, '코어': 0 };

// ★ 천장(Pity) 한도 — 상자별 전차 미획득 연속 횟수 상한
const PITY_LIMIT = { '파편': 50, '조각': 40, '코어': 20 };
const pityCount = { '파편': 0, '조각': 0, '코어': 0 };

// 수령 완료 아이템(y:true)
const ownedSet = new Set();
const preOwnedSet = new Set();

// 누적 인벤토리 { 아이템명: 총수량 }
const inventory = {};

// 통계
let totalOpened = 0;
let totalSpent = 0;
let freeClaimUsed = false;

// 상자 유형별 개봉 횟수 (천장 카운터와 독립)
const openedCount = { '파편': 0, '조각': 0, '코어': 0 };

// 전차 획득 기록 { 전차명: { boxType, atCount } }
// atCount = 해당 상자 유형의 N번째 개봉 시 획득
const tankLog = {};

// 슬롯1(전차)에서 대체 보상 획득 횟수
const altTankCount = { '파편': 0, '조각': 0, '코어': 0 };

// 기타 소모품 대체 보상 획득 누적량
const altConsumableCount = {};


/* ──────────────────────────────────────────────
   § 2. 데이터 로드 (Data Loading)
   ────────────────────────────────────────────── */

async function loadData() {
    try {
        // gacha_data.json + shop_data.json 병렬 로드
        [gachaData, shopData] = await Promise.all([
            fetch('gacha_data.json').then(r => {
                if (!r.ok) throw new Error('가챠 데이터 로드 실패');
                return r.json();
            }),
            fetch('shop_data.json').then(r => {
                if (!r.ok) throw new Error('상점 데이터 로드 실패');
                return r.json();
            })
        ]);

        // 사전 보유 캐시 로드
        const cached = localStorage.getItem('mirny_preowned');
        if (cached) {
            try {
                const arr = JSON.parse(cached);
                arr.forEach(item => preOwnedSet.add(item));
            } catch(e) {
                console.error('캐시 파싱 실패:', e);
            }
        }
        // 사전 보유 아이템을 현재 보유 목록에 기본 세팅
        preOwnedSet.forEach(item => ownedSet.add(item));

        initChecklist();
        initShop();
        updateInventoryUI();
    } catch (error) {
        console.error('데이터 로드 오류:', error);
        alert('데이터를 불러오는 중 오류가 발생했습니다.\n페이지를 새로고침해주세요.');
    }
}


/* ──────────────────────────────────────────────
   § 3. 체크리스트 (Checklist)
   ────────────────────────────────────────────── */

// y:true 아이템을 상자별 + 슬롯1(전차)/나머지(치장품)로 분류해 체크리스트 생성
function initChecklist() {
    const boxTanks = { '파편': new Set(), '조각': new Set(), '코어': new Set() };
    const boxCosmetics = { '파편': new Set(), '조각': new Set(), '코어': new Set() };

    for (const box in gachaData) {
        gachaData[box].slots.forEach(slot => {
            slot.groups.forEach(g => g.items.forEach(item => {
                if (item.y) {
                    if (slot.id === '슬롯1') boxTanks[box].add(item.name);
                    else boxCosmetics[box].add(item.name);
                }
            }));
        });
    }
    
    // 사이드바 실시간 체크리스트
    renderChecklistByBox(boxTanks, 'tanks-list', false);
    renderChecklistByBox(boxCosmetics, 'cosmetics-list', false);
    
    // 사전 보유 설정 모달 체크리스트
    renderChecklistByBox(boxTanks, 'pre-tanks-list', true);
    renderChecklistByBox(boxCosmetics, 'pre-cosmetics-list', true);
}

function renderChecklistByBox(boxMap, containerId, isPreOwned = false) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = '';
    
    for (const boxName of ['파편', '조각', '코어']) {
        const names = [...boxMap[boxName]].sort();
        if (names.length === 0) continue;
        
        el.insertAdjacentHTML('beforeend', `<div class="box-section-header">─ ${boxName} 상자 ─</div>`);
        names.forEach(name => {
            const div = document.createElement('div');
            div.className = 'checklist-item';
            div.tabIndex = 0;
            const prefix = isPreOwned ? 'pre_' : '';
            div.id = `${prefix}wrap_${CSS.escape(name)}`;
            div.innerHTML = `
                <input type="checkbox" id="${prefix}chk_${name}" value="${name}">
                <label for="${prefix}chk_${name}">${name}</label>`;
            
            const cb = div.querySelector('input');
            const isChecked = isPreOwned ? preOwnedSet.has(name) : ownedSet.has(name);
            cb.checked = isChecked;
            if (isChecked) div.classList.add('owned');
            
            cb.addEventListener('change', e => {
                if (isPreOwned) {
                    e.target.checked ? preOwnedSet.add(name) : preOwnedSet.delete(name);
                } else {
                    e.target.checked ? ownedSet.add(name) : ownedSet.delete(name);
                }
                div.classList.toggle('owned', e.target.checked);
            });
            div.addEventListener('click', e => {
                if (e.target.matches('input, label')) return;
                cb.checked = !cb.checked;
                cb.dispatchEvent(new Event('change', { bubbles: true }));
            });
            div.addEventListener('keydown', e => {
                if (e.key !== ' ' && e.key !== 'Enter') return;
                e.preventDefault();
                cb.checked = !cb.checked;
                cb.dispatchEvent(new Event('change', { bubbles: true }));
            });
            el.appendChild(div);
        });
    }
}

const isOwned = name => ownedSet.has(name);

function setOwned(name) {
    if (ownedSet.has(name)) return;
    ownedSet.add(name);
    const cb = document.getElementById(`chk_${name}`);
    const wrap = document.getElementById(`wrap_${CSS.escape(name)}`);
    if (cb) cb.checked = true;
    if (wrap) wrap.classList.add('owned');
}


/* ──────────────────────────────────────────────
   § 4. 핵심 뽑기 로직 (Core Gacha Logic)
   ────────────────────────────────────────────── */

// prob 가중치 배열에서 랜덤 하나 선택 (부동소수점 오차 방지를 위해 확률 합계 정규화)
function weightedRandom(arr) {
    let sum = 0;
    for (const item of arr) sum += item.prob;
    let r = Math.random() * sum, s = 0;
    for (const item of arr) { s += item.prob; if (r <= s) return item; }
    return arr[arr.length - 1];
}

function addInventory(name, qty) {
    inventory[name] = (inventory[name] || 0) + qty;
}

/**
 * y:true 그룹에서 수령 여부를 고려해 아이템 선택
 *  - 미수령 없으면 대체보상(alt) 반환
 *  - 수령된 확률은 미수령 아이템에 균등 분배
 */
function pickFromYGroup(group) {
    const remaining = [];
    let removed = 0;
    group.items.forEach(item => {
        if (isOwned(item.name)) removed += item.prob;
        else remaining.push({ ...item });
    });
    if (!remaining.length) {
        const picked = weightedRandom(group.items);
        return { chosen: picked.alt || picked.name, alt: true };
    }
    if (removed > 0) {
        const bonus = removed / remaining.length;
        remaining.forEach(i => i.prob += bonus);
    }
    return { chosen: weightedRandom(remaining).name, alt: false };
}

/**
 * 단일 상자 시뮬레이션 → 슬롯별 결과 배열 반환
 *  - 슬롯1: 천장 카운터 적용 (전차 전용)
 *  - 기타: 수령 여부 기반 확률 재분배
 */
function simulateBox(boxName) {
    const results = [];
    gachaData[boxName].slots.forEach(slot => {
        let name, qty, isNew = false, isAlt = false, isPity = false;

        if (slot.id === '슬롯1' && boxName in PITY_LIMIT) {
            // ── 전차 슬롯: 천장 시스템 ──
            pityCount[boxName]++;
            const atCeiling = pityCount[boxName] >= PITY_LIMIT[boxName];
            const rolled = weightedRandom(slot.groups);
            const rolledTank = rolled.items.some(i => i.y);
            const tankGroup = rolledTank ? rolled : slot.groups.find(g => g.items.some(i => i.y));

            if (atCeiling || rolledTank) {
                const r = pickFromYGroup(tankGroup);
                name = r.chosen; qty = 1;
                if (r.alt) { isAlt = true; }
                else { isNew = true; if (atCeiling && !rolledTank) isPity = true; }
                pityCount[boxName] = 0;         // 전차 획득 → 천장 초기화
            } else {
                const sel = weightedRandom(rolled.items);
                name = sel.name; qty = sel.qty; // 꽝
            }
        } else {
            // ── 일반 슬롯 ──
            const group = weightedRandom(slot.groups);
            if (group.items.some(i => i.y)) {
                const r = pickFromYGroup(group);
                name = r.chosen; qty = 1;
                if (r.alt) isAlt = true; else isNew = true;
            } else {
                const sel = weightedRandom(group.items);
                name = sel.name; qty = sel.qty;
            }
        }

        results.push({ slotId: slot.id, name, qty, isNew, isAlt, isPity, isDud: name === '꽝' });
        addInventory(name, qty);
        if (isNew) setOwned(name);
    });
    return results;
}


/* ──────────────────────────────────────────────
   § 5. 상자 열기 (Open Boxes)
   ────────────────────────────────────────────── */

function openBoxes(boxName, count) {
    if (boxInventory[boxName] < count) {
        alert(`${boxName} 상자 부족\n보유 ${boxInventory[boxName]}개 / 필요 ${count}개`);
        return;
    }
    boxInventory[boxName] -= count;

    const logEl = document.getElementById('result-log');
    if (totalOpened === 0) logEl.querySelector('.log-placeholder')?.remove();

    for (let i = 0; i < count; i++) {
        totalOpened++;
        openedCount[boxName]++;           // 해당 상자 유형 개봉 횟수 증가
        const results = simulateBox(boxName);

        results.forEach(r => {
            // 보상 상자 재고 추가
            if (!r.isDud && r.name in boxInventory) boxInventory[r.name] += r.qty;
            // 전차 슬롯에서 신규 획득 시 기록
            if (r.slotId === '슬롯1' && r.isNew && !tankLog[r.name]) {
                tankLog[r.name] = { boxType: boxName, atCount: openedCount[boxName] };
            }
            // 전차 슬롯에서 대체 보상 획득 시 횟수 증가
            if (r.slotId === '슬롯1' && r.isAlt) {
                altTankCount[boxName]++;
            }
            // 모든 대체 보상의 획득량을 기대값 보정을 위해 기록
            if (r.isAlt) {
                altConsumableCount[r.name] = (altConsumableCount[r.name] || 0) + r.qty;
            }
        });

        logEl.insertAdjacentHTML('afterbegin', buildLogEntry(boxName, results));
    }

    updateInventoryUI();
    updatePityUI();
    updateStatsBar();
    updateSummaryUI();
}

/**
 * 보유한 모든 상자 열기
 */
function openAllBoxes(boxName) {
    const count = boxInventory[boxName];
    
    if (count === 0) {
        alert(`${boxName} 상자가 없습니다.`);
        return;
    }
    
    // 대량 개봉 시 확인
    if (count > 50) {
        if (!confirm(`${boxName} 상자 ${count}개를 모두 열겠습니까?\n\n⚠️ 대량 개봉은 시간이 걸릴 수 있습니다.`)) {
            return;
        }
    } else if (count > 10) {
        if (!confirm(`${boxName} 상자 ${count}개를 모두 열겠습니까?`)) {
            return;
        }
    }
    
    // 성능 최적화를 위해 openBoxes 호출
    openBoxes(boxName, count);
}


/* ──────────────────────────────────────────────
   § 6. 로그 HTML 생성 (Log Builder)
   ────────────────────────────────────────────── */

function buildLogEntry(boxName, results) {
    const colors = { '파편': 'var(--box-shard)', '조각': 'var(--box-piece)', '코어': 'var(--box-core)' };
    const c = colors[boxName] || 'var(--muted)';

    const rows = results.map(r => {
        const nc = r.isDud ? 'var(--dud)' : (r.isNew ? 'var(--success)' : 'var(--log-item-name)');
        const tag = r.isPity ? '<span class="tag-pity">천장!</span>'
            : r.isNew ? '<span class="tag-new">NEW!</span>'
                : r.isAlt ? '<span class="tag-alt">대체보상</span>' : '';
        const qty = r.isDud ? '' : `<span class="log-qty">x${r.qty.toLocaleString()}</span>`;
        return `<div class="log-item">
            <span><span class="log-slot-label">[${r.slotId}]</span>
            <span style="color:${nc}">${r.name}</span>${tag}</span>${qty}</div>`;
    }).join('');

    return `<div class="log-entry">
        <div class="log-entry-title">#${totalOpened}
            <span class="box-badge" style="color:${c};border-color:${c};background:color-mix(in srgb, ${c} 10%, transparent)">
                ${boxName} 상자</span></div>
        ${rows}</div>`;
}


/* ──────────────────────────────────────────────
   § 7. UI 갱신 (UI Refresh)
   ────────────────────────────────────────────── */

// 재고 뱃지 + 열기 버튼 활성화
function updateInventoryUI() {
    for (const name in boxInventory) {
        const count = boxInventory[name];
        
        // 재고 표시
        document.querySelectorAll(`[id="inv-count-${name}"]`)
            .forEach(el => el.textContent = count.toLocaleString());
        
        // 개별 버튼 활성화 (1개, 5개)
        document.querySelectorAll(`.box-open-btn[data-box="${name}"][data-count]`)
            .forEach(btn => {
                const requiredCount = +btn.dataset.count;
                btn.disabled = count < requiredCount;
            });
        
        // 모두 열기 버튼 활성화
        document.querySelectorAll(`.box-open-all-btn[data-box="${name}"]`)
            .forEach(btn => {
                btn.disabled = count === 0;
                // 버튼 텍스트에 개수 표시
                if (count > 0) {
                    btn.textContent = `모두 열기 (${count}개)`;
                } else {
                    btn.textContent = '모두 열기';
                }
            });
    }
}

// 천장 프로그레스 바
function updatePityUI() {
    for (const name in PITY_LIMIT) {
        const pct = Math.round(pityCount[name] / PITY_LIMIT[name] * 100);
        const bar = document.getElementById(`pity-bar-${name}`);
        const txt = document.getElementById(`pity-text-${name}`);
        if (bar) { bar.style.width = `${pct}%`; bar.className = 'pity-fill' + (pct >= 80 ? ' pity-warn' : ''); }
        if (txt) txt.textContent = `${pityCount[name]} / ${PITY_LIMIT[name]}`;
    }
}

// 통계 바
function updateStatsBar() {
    const el = document.getElementById('stats-bar');
    if (el) el.innerHTML = `
        <span>총 개봉 <strong>${totalOpened}</strong>개</span>
        <span>획득 종류 <strong>${Object.keys(inventory).filter(k => k !== '꽝').length}</strong>종</span>`;
}

// 종합 패널 (종합 운 지수 + 전차 상세 + 치장품 + 소모품 + 통계)
function updateSummaryUI() {
    const el = document.getElementById('result-summary');
    if (!el) return;
    el.innerHTML = '';

    // ── 종합 운 지수 카드 (단일 통합) ──
    const luck = calcComprehensiveLuck();
    if (luck) {
        const barW = Math.round((1 - luck.score) * 100);
        el.insertAdjacentHTML('beforeend', `
            <div class="luck-card">
                <div class="luck-card-title">🎯 종합 운 지수</div>
                <div class="luck-card-badge-row">
                    <span class="luck-badge ${luck.cls} luck-badge-lg">${luck.label}</span>
                    <span class="luck-card-detail">${luck.detail}</span>
                </div>
                <div class="luck-meter-wrap">
                    <div class="luck-meter-track">
                        <div class="luck-meter-fill ${luck.cls}" style="width:${barW}%"></div>
                    </div>
                    <div class="luck-meter-labels">
                        <span>불운</span><span>평균</span><span>행운</span>
                    </div>
                </div>
                <div class="luck-card-note">전차 운(75%) + 상자 드롭 운(15%) + 소모품 운(10%) 가중 합산 반영</div>
            </div>`);
    }

    // 전차 / 치장품 분류
    const boxTanks = { '파편': new Set(), '조각': new Set(), '코어': new Set() };
    const boxCosmetics = { '파편': new Set(), '조각': new Set(), '코어': new Set() };
    const yNames = new Set();
    
    for (const box in gachaData) {
        gachaData[box].slots.forEach(slot => {
            slot.groups.forEach(g => g.items.forEach(item => {
                if (item.y) {
                    yNames.add(item.name);
                    if (slot.id === '슬롯1') boxTanks[box].add(item.name);
                    else boxCosmetics[box].add(item.name);
                }
            }));
        });
    }

    // ── 전차 섹션: 획득 상자 + 개봉 횟수 + 운 배지 표시 ──
    el.insertAdjacentHTML('beforeend', `<div class="summary-item category-header">🚀 전차</div>`);
    for (const boxName of ['파편', '조각', '코어']) {
        const tanks = [...boxTanks[boxName]].sort();
        if (tanks.length === 0) continue;
        el.insertAdjacentHTML('beforeend', `<div class="box-section-header">─ ${boxName} 상자 (${openedCount[boxName]}개 개봉) ─</div>`);
        tanks.forEach(name => {
            if (tankLog[name]) {
                const { boxType, atCount } = tankLog[name];
                const info = getTankExpected(name);
                let luckBadge = '';
                if (info) {
                    const expRounded = Math.round(info.expected);
                    if (atCount < info.expected) {
                        luckBadge = `<span class="tank-luck-badge luck-good">🍀 운 좋음</span><span class="tank-expect-note">(기대 ${expRounded}개)</span>`;
                    } else if (atCount > info.expected) {
                        luckBadge = `<span class="tank-luck-badge luck-bad">🔴 운 나쁨</span><span class="tank-expect-note">(기대 ${expRounded}개)</span>`;
                    } else {
                        luckBadge = `<span class="tank-luck-badge luck-avg">⚖ 평균</span><span class="tank-expect-note">(기대 ${expRounded}개)</span>`;
                    }
                }
                el.insertAdjacentHTML('beforeend', `
                    <div class="summary-item tank-item">
                        <span class="tank-name">✓ ${name}</span>
                        <span class="tank-meta">${boxType} ${atCount}개째 ${luckBadge}</span>
                    </div>`);
            } else {
                // 미획득 전차: 기대 개봉 수 표시
                const info = getTankExpected(name);
                const expNote = info ? `<span class="tank-expect-note muted">(기대 ${Math.round(info.expected)}개)</span>` : '';
                el.insertAdjacentHTML('beforeend', `
                    <div class="summary-item tank-item not-acquired">
                        <span class="tank-name muted">✗ ${name}</span>
                        <span class="tank-meta">${expNote}</span>
                    </div>`);
            }
        });
    }

    // ── 치장품 섹션 ──
    const hasCosmetics = Object.values(boxCosmetics).some(s => [...s].some(n => inventory[n]));
    if (hasCosmetics) {
        el.insertAdjacentHTML('beforeend', `<div class="summary-item category-header">🎨 치장품</div>`);
        for (const boxName of ['파편', '조각', '코어']) {
            const cosmeticItems = [...boxCosmetics[boxName]].sort().filter(n => inventory[n]);
            if (cosmeticItems.length === 0) continue;
            el.insertAdjacentHTML('beforeend', `<div class="box-section-header">─ ${boxName} 상자 ─</div>`);
            cosmeticItems.forEach(n => el.insertAdjacentHTML('beforeend', `
                <div class="summary-item"><span>${n}</span>
                <strong class="summary-item-count">${inventory[n].toLocaleString()}</strong></div>`));
        }
    }

    // ── 소모품 / 기타 카테고리 세분화 ──
    const categories = [
        { title: '💎 자원', keys: ['크래딧', '자유 경험치', '골드', '프리미엄', '부속품'] },
        { title: '📦 물자', keys: ['자경물자', '경험치 물자', '크래딧 물자', '자경물자 300', '경험치 물자 100', '크래딧 물자 100'] },
        { title: '📖 승무원 교본', keys: ['책자', '지침', '교본', '훈련교본'] },
        { title: '🗃️ 상자', keys: ['파편', '조각', '코어'] },
        { title: '⚡ 기타', keys: ['5배임무', '승무원 1', '승무원 2', '승무원 3'] }
    ];

    const consLuck = calcConsumableLuck();
    const otherNames = new Set(Object.keys(inventory).filter(n => !yNames.has(n) && n !== '꽝'));
    
    categories.forEach(cat => {
        const catItems = cat.keys.filter(n => inventory[n]);
        if (catItems.length > 0) {
            el.insertAdjacentHTML('beforeend', `<div class="summary-item category-header">${cat.title}</div>`);
            catItems.forEach(n => {
                otherNames.delete(n); // 매칭된 아이템은 제거
                let luckHtml = '';
                if (consLuck && consLuck.itemLuck[n]) {
                    const l = consLuck.itemLuck[n];
                    luckHtml = ` <span class="${l.luckCls}" style="font-size:13px; margin-left:6px;">${l.luckArrow} (기대 ${Math.round(l.exp).toLocaleString()})</span>`;
                }
                
                el.insertAdjacentHTML('beforeend', `
                    <div class="summary-item">
                        <span>${n}${luckHtml}</span>
                        <strong class="summary-item-count">${inventory[n].toLocaleString()}</strong>
                    </div>`);
            });
        }
    });

    // 지정되지 않은 나머지 미분류 기타 아이템
    const leftover = Array.from(otherNames).sort();
    if (leftover.length > 0) {
        el.insertAdjacentHTML('beforeend', `<div class="summary-item category-header">❓ 기타 미분류</div>`);
        leftover.forEach(n => {
            let luckHtml = '';
            if (consLuck && consLuck.itemLuck[n]) {
                const l = consLuck.itemLuck[n];
                luckHtml = ` <span class="${l.luckCls}" style="font-size:13px; margin-left:6px;">${l.luckArrow} (기대 ${Math.round(l.exp).toLocaleString()})</span>`;
            }
            el.insertAdjacentHTML('beforeend', `
                <div class="summary-item">
                    <span>${n}${luckHtml}</span>
                    <strong class="summary-item-count">${inventory[n].toLocaleString()}</strong>
                </div>`);
        });
    }

    // ── 상자별 통계 섹션 (천장 반영 기대값 기준) ──
    if (Object.values(openedCount).some(v => v > 0)) {
        el.insertAdjacentHTML('beforeend', `<div class="summary-item category-header">📊 상자별 통계</div>`);
        for (const boxName in openedCount) {
            const n = openedCount[boxName];
            if (n === 0) continue;
            const slot1 = gachaData[boxName]?.slots.find(s => s.id === '슬롯1');
            const tg = slot1?.groups.find(g => g.items.some(i => i.y));
            if (!tg) continue;
            const p = tg.prob, C = PITY_LIMIT[boxName];
            // 천장 반영 기대 전차 수 = N / E[상자당 전차 1개]
            const expPerTank = expectedBoxesWithPity(p, 1, C);
            const expTanks = (n / expPerTank);
            // 실제 전차 수 = 획득한 전차 수 + 전차를 대체 보상으로 받은 수
            const realTanks = Object.values(tankLog).filter(l => l.boxType === boxName).length + altTankCount[boxName];
            const luckArrow = realTanks > expTanks ? '⬆️ 운 좋음' : realTanks < expTanks ? '⬇️ 운 나쁨' : '⚖ 평균';
            const luckCls = realTanks > expTanks ? 'stat-luck-good' : realTanks < expTanks ? 'stat-luck-bad' : 'stat-luck-avg';
            el.insertAdjacentHTML('beforeend', `
                <div class="summary-item">
                    <span>${boxName} ${n.toLocaleString()}개 개봉</span>
                    <span class="stat-detail">전차(대체포함) ${realTanks}개 <span class="${luckCls}">${luckArrow}</span> <span class="muted">(기대 ${expTanks.toFixed(1)}개)</span></span>
                </div>`);
        }
    }

    const modalSummary = document.getElementById('modal-summary-content');
    if (modalSummary) {
        modalSummary.innerHTML = el.innerHTML;
    }
}

function openSummaryModal() { document.getElementById('summary-modal')?.classList.add('open'); }
function closeSummaryModal() { document.getElementById('summary-modal')?.classList.remove('open'); }

// 총 구매 비용
function updateTotalCostUI() {
    const t = totalSpent.toLocaleString() + '원';
    document.querySelectorAll('.total-cost-display').forEach(el => el.textContent = t);
}

/**
 * ★ 천장을 고려한 기대 개봉 횟수 — Markov chain 풀이
 *   상태: 현재 pity 카운터 k (0 ~ C-1)
 *   E[k] = A[k] + B[k] * E[0]  로 표현하여 역방향으로 풀이
 * @param {number} p - 전차 그룹 확률
 * @param {number} q - 그룹 내 해당 전차 확률
 * @param {number} C - 천장 한도
 */
function expectedBoxesWithPity(p, q, C) {
    const A = new Array(C), B = new Array(C);
    A[C - 1] = 1; B[C - 1] = 1 - q;          // 천장 직전 상태
    for (let k = C - 2; k >= 0; k--) {
        A[k] = 1 + (1 - p) * A[k + 1];
        B[k] = p * (1 - q) + (1 - p) * B[k + 1];
    }
    return A[0] / (1 - B[0]);             // E[0] 최종 답
}

/**
 * ★ 특정 전차 1개가 나올 때까지의 기대 전차 획득 횟수 계산 (중복 획득 시 확률 분배 반영)
 */
function getExpectedTankDrops(targetName, tgItems) {
    const memo = new Map();
    const items = tgItems.filter(i => i.y);
    
    function dp(ownedNames) {
        if (ownedNames.includes(targetName)) return 0;
        const key = ownedNames.join(',');
        if (memo.has(key)) return memo.get(key);
        
        let removed = 0;
        const remaining = [];
        for (const item of items) {
            if (ownedNames.includes(item.name)) removed += item.prob;
            else remaining.push({ ...item });
        }
        if (remaining.length === 0) return 0;
        
        if (removed > 0) {
            const bonus = removed / remaining.length;
            remaining.forEach(i => i.prob += bonus);
        }
        
        let exp = 1;
        for (const item of remaining) {
            if (item.name !== targetName) {
                const nextList = [...ownedNames, item.name].sort();
                exp += item.prob * dp(nextList);
            }
        }
        memo.set(key, exp);
        return exp;
    }
    return dp([]);
}

/**
 * ★ 특정 전차 1개의 기대 개봉 횟수 계산
 *   - p: 전차 그룹 확률, C: 천장
 *   - 천장을 포함해 '전차 1대'를 얻는 기대 횟수 × 특정 전차를 얻기 위한 전차 획득 기대 횟수(DP)
 */
function expectedBoxesForTank(p, targetName, tgItems, C) {
    const expBoxesPerTank = expectedBoxesWithPity(p, 1, C);
    const expTanks = getExpectedTankDrops(targetName, tgItems);
    return expBoxesPerTank * expTanks;
}

/**
 * ★ 전차명으로 해당 상자 정보 조회
 *   반환: { boxName, p, q, C, expected } 또는 null
 */
function getTankExpected(tankName) {
    for (const boxName in gachaData) {
        if (!(boxName in PITY_LIMIT)) continue;
        const slot1 = gachaData[boxName].slots.find(s => s.id === '슬롯1');
        const tg = slot1?.groups.find(g => g.items.some(i => i.y));
        if (!tg) continue;
        const item = tg.items.find(i => i.name === tankName && i.y);
        if (!item) continue;
        const p = tg.prob, q = item.prob, C = PITY_LIMIT[boxName];
        const expected = expectedBoxesForTank(p, tankName, tg.items, C);
        return { boxName, p, q, C, expected };
    }
    return null;
}

/**
 * ★ 천장 고려 CDF: N번 개봉 이내에 특정 전차를 획득할 확률
 *   Markov chain �/**
 * ★ 소모품 운 지수 연산
 *   - 각 소모품/기타 자원에 대해 (실제 획득 수량 / 기대 수량) 비율을 통해 운 점수를 계산
 */
function calcConsumableLuck() {
    if (!gachaData) return null;
    const expectedConsumables = {};
    let hasData = false;

    for (const boxName in openedCount) {
        const n = openedCount[boxName];
        if (n === 0) continue;
        hasData = true;
        gachaData[boxName].slots.forEach(slot => {
            slot.groups.forEach(g => {
                g.items.forEach(i => {
                    // 상자 드롭(파편, 조각, 코어)의 기대치와 개별 운 여부도 UI 표시를 위해 계산
                    if (!i.y && i.name !== '꽝') {
                        const expQty = n * g.prob * i.prob * i.qty;
                        expectedConsumables[i.name] = (expectedConsumables[i.name] || 0) + expQty;
                    }
                });
            });
        });
    }

    if (!hasData) return null;

    let totalScore = 0;
    let itemCount = 0;
    const itemLuck = {};

    for (const name in expectedConsumables) {
        let exp = expectedConsumables[name];
        // 대체 보상으로 얻은 경우, 확률적 손실 없이 100% 확정 획득한 것이므로 기대값에도 동일하게 더해준다
        if (altConsumableCount[name]) {
            exp += altConsumableCount[name];
        }

        if (exp > 0) {
            const act = inventory[name] || 0;
            const ratio = act / exp;
            const score = Math.max(0, Math.min(1, 1 - ratio / 2));
            
            // 상자 드롭(파편, 조각, 코어)은 개별 항목 UI 표시용으로만 남기고 소모품 전체 운 지수(totalScore)에서는 제외
            if (!['파편', '조각', '코어'].includes(name)) {
                totalScore += score;
                itemCount++;
            }
            
            let luckCls = 'stat-luck-avg';
            let luckArrow = '⚖ 평균';
            if (ratio > 1.05) { luckCls = 'stat-luck-good'; luckArrow = '⬆️ 운 좋음'; }
            else if (ratio < 0.95) { luckCls = 'stat-luck-bad'; luckArrow = '⬇️ 운 나쁨'; }
            itemLuck[name] = { exp, act, ratio, score, luckCls, luckArrow };
        }
    }

    const avgScore = itemCount > 0 ? totalScore / itemCount : 0.5;
    return { score: avgScore, itemLuck };
}

/**
 * ★ 종합 운 지수 연산 — 3개 상자 통합
 *
 * 판단 기준: 실제 전차수 / 기대 전차수 (기본 확률 + 천장)
 *
 *   기대 전차수 = N / expectedBoxesWithPity(p, 1, C)
 *     • p   = 전차 그룹 원본 확률
 *     • q=1 = 그룹 트리거 → 반드시 의미하는 전차 (독립 전차 구분 없이)
 *     • C   = 천장
 *
 *   비율 = 실제 / 기대
 *     • 비율 ≥ 1  → 행운 (score 0.0 방향)
 *     • 비율 = 1  → 평균 (score 0.5)
 *     • 비율 = 0  → 불운 (score 1.0)
 *
 *   상자별 합산(가중 평균) 후, 소모품 운(30%) 반영
 */
function calcComprehensiveLuck() {
    if (!gachaData) return null;

    let totalWeight = 0;   // 전체 개봉 수 (가중치)
    let weightedScore = 0;  // 가중 점수 합

    for (const boxName in openedCount) {
        const n = openedCount[boxName];
        if (n === 0) continue;

        const slot1 = gachaData[boxName]?.slots.find(s => s.id === '슬롯1');
        const tg = slot1?.groups.find(g => g.items.some(i => i.y));
        if (!tg) continue;

        const p = tg.prob, C = PITY_LIMIT[boxName];

        // 상자 1개당 기대 전차 회수
        const expPerTank = expectedBoxesWithPity(p, 1, C);  // E[상자 당 전차 1개]
        const expectedTanks = n / expPerTank;               // N개 열었을 때 기대 전차 수

        // 실제 획득 전차 수 (대체 보상 포함)
        const actualTanks = Object.values(tankLog).filter(l => l.boxType === boxName).length + altTankCount[boxName];

        // 비율 → 점수 (0=행운, 1=불운)
        const ratio = actualTanks / Math.max(expectedTanks, 0.001);
        const score = Math.max(0, Math.min(1, 1 - ratio / 2));

        // 각 상자의 기댓값 기반 비용(원화 가치) 비율을 가중치로 사용 (연쇄 드롭 확률 포함)
        // 파편: 1, 조각: 약 6.3, 코어: 약 36
        const weightMap = { '파편': 1, '조각': 6.3, '코어': 36 };
        const weightMultiplier = weightMap[boxName] || 1;
        const weight = n * weightMultiplier;

        weightedScore += score * weight;
        totalWeight += weight;
    }

    if (totalWeight === 0) return null;

    const tankScore = weightedScore / totalWeight;

    // 소모품 운 지수 (상자 제외)
    const consLuck = calcConsumableLuck();
    const consScore = consLuck ? consLuck.score : 0.5;

    // ── 상자 내 상자 드롭 운 지수 연산 ──
    // 각 상자의 기댓값 기반 비용(원화 가치) 비율을 가중치로 사용 (연쇄 드롭 확률 포함)
    // 가중치: 파편 1, 조각 6.3, 코어 36
    // 상위 상자에서 하위 상자가 나오면 기대 가치 대비 실제 획득 가치가 떨어져 불운으로 평가됨
    const boxWeights = { '파편': 1, '조각': 6.3, '코어': 36 };
    let expectedBoxVal = 0;
    let actualBoxVal = 0;

    for (const bName in openedCount) {
        const nBox = openedCount[bName];
        if (nBox === 0 || !gachaData[bName]) continue;
        gachaData[bName].slots.forEach(slot => {
            slot.groups.forEach(g => {
                g.items.forEach(i => {
                    if (boxWeights[i.name]) {
                        expectedBoxVal += nBox * g.prob * i.prob * i.qty * boxWeights[i.name];
                    }
                });
            });
        });
    }

    for (const name in boxWeights) {
        actualBoxVal += (inventory[name] || 0) * boxWeights[name];
    }

    let boxDropScore = 0.5;
    if (expectedBoxVal > 0) {
        const boxRatio = actualBoxVal / expectedBoxVal;
        // ratio > 1: 행운, ratio < 1: 불운
        boxDropScore = Math.max(0, Math.min(1, 1 - boxRatio / 2));
    }

    // 종합 (전차 75%, 상자 드롭 15%, 소모품 10%)
    const avg = tankScore * 0.75 + boxDropScore * 0.15 + consScore * 0.1;

    // 통합 점수 → 라벨
    const top = Math.round((1 - avg) * 100);
    const bot = Math.round(avg * 100);
    if (avg < 0.25) return { score: avg, label: `🍀 상위 ${top}%`, cls: 'luck-great', detail: '매우 운 좋음' };
    if (avg < 0.45) return { score: avg, label: `✨ 상위 ${top}%`, cls: 'luck-good', detail: '운 좋음' };
    if (avg < 0.55) return { score: avg, label: `⚖ 평균`, cls: 'luck-avg', detail: '평균' };
    if (avg < 0.75) return { score: avg, label: `🟡 하위 ${bot}%`, cls: 'luck-avg', detail: '운 나쁨' };
    return { score: avg, label: `🔴 하위 ${bot}%`, cls: 'luck-bad', detail: '매우 운 나쁨' };
}






/**
 * percentile → 운 등급 배지 반환
 * percentile = P(N번 이내 획득)  낮을수록 Lucky
 */
function luckLabel(percentile) {
    const top = Math.round((1 - percentile) * 100);
    const bot = Math.round(percentile * 100);
    if (percentile < 0.25) return { text: `🍀 상위 ${top}%`, cls: 'luck-great' };
    if (percentile < 0.50) return { text: `✨ 상위 ${top}%`, cls: 'luck-good' };
    if (percentile < 0.75) return { text: `🟡 하위 ${bot}%`, cls: 'luck-avg' };
    return { text: `🔴 하위 ${bot}%`, cls: 'luck-bad' };
}

/**
 * ★ 상자 유형별 운 지수 계산
 *
 * [점수 체계]  0 = 매우 Lucky,  1 = 매우 Unlucky
 *
 * ① 획득 전차: pityAwareCDF(획득 시점, baseQ)  → 낮을수록 Lucky
 * ② 미획득 전차: pityAwareCDF(현재 개봉 수, q_eff) > 0.5 일 때만 집계
 * ③ 파편 상자일 경우 지출 보정 30% 반영
 *
 * @param {string} boxName  '파편' | '조각' | '코어'
 * @returns {{ score, label, cls } | null}  해당 상자 개봉 이력 없으면 null
 */
function calcBoxLuck(boxName) {
    if (!gachaData) return null;
    const n = openedCount[boxName];

    const slot1 = gachaData[boxName]?.slots.find(s => s.id === '슬롯1');
    const tg = slot1?.groups.find(g => g.items.some(i => i.y));
    if (!tg) return null;

    const p = tg.prob, C = PITY_LIMIT[boxName];
    const scores = [];

    tg.items.filter(i => i.y).forEach(item => {
        const info = getTankInfo(item.name);
        if (!info || info.boxName !== boxName) return;

        if (tankLog[item.name]) {
            // 획득: baseQ(원래 확률) 기준 — 획득 당시 확률과 공정 비교
            const at = tankLog[item.name].atCount;
            scores.push(pityAwareCDF(p, info.baseQ, C, at));
        } else if (n > 0) {
            // 미획득: q_eff(재분배 반영) 기준, 0.5 초과 시만 집계
            const cdf = pityAwareCDF(p, info.q, C, n);
            if (cdf > 0.5) scores.push(cdf);
        }
    });

    // 집계 가능한 전차 없음 → "집계 중"
    if (!scores.length) {
        return { score: 0.5, label: n > 0 ? '⚖ 집계 중' : '— 미개봉', cls: 'luck-avg' };
    }

    let avg = scores.reduce((a, b) => a + b, 0) / scores.length;

    // 파편 상자 지출 보정 (유료 구매 있을 때만)
    if (boxName === '파편' && totalSpent > 0 && Object.keys(tankLog).length > 0) {
        const paid = shopData?.packages.filter(p => !p.freeOnly && p.price > 0) ?? [];
        const unitCost = paid.length ? Math.min(...paid.map(p => p.price / p.count)) : 0;
        let expectedCost = 0;
        Object.keys(tankLog).forEach(name => {
            const info = getTankInfo(name);
            if (info && info.boxName === '파편') expectedCost += info.expected * unitCost;
        });
        if (expectedCost > 0) {
            const costScore = Math.min(totalSpent / expectedCost, 2) / 2;
            avg = avg * 0.7 + costScore * 0.3;
        }
    }

    return makeLuckScore(Math.max(0, Math.min(1, avg)));
}

/** avg(0~1) → 운 등급 객체 변환 */
function makeLuckScore(avg) {
    const top = Math.round((1 - avg) * 100);
    const bot = Math.round(avg * 100);
    if (avg < 0.25) return { score: avg, label: `🍀 상위 ${top}%`, cls: 'luck-great' };
    if (avg < 0.45) return { score: avg, label: `✨ 상위 ${top}%`, cls: 'luck-good' };
    if (avg < 0.55) return { score: avg, label: `⚖ 평균`, cls: 'luck-avg' };
    if (avg < 0.75) return { score: avg, label: `🟡 하위 ${bot}%`, cls: 'luck-avg' };
    return { score: avg, label: `🔴 하위 ${bot}%`, cls: 'luck-bad' };
}



/* ──────────────────────────────────────────────
   § 8. 상점 (Shop)
   ────────────────────────────────────────────── */

function initShop() {
    // shop_data.json 기반으로 모든 .shop-packages 컨테이너에 버튼 생성
    document.querySelectorAll('.shop-packages').forEach(container => {
        container.innerHTML = '';
        shopData.packages.forEach(pkg => {
            const price = pkg.price === 0 ? '무료' : pkg.price.toLocaleString() + '원';
            const div = document.createElement('div');
            div.className = 'shop-pkg';
            div.innerHTML = `
                <div class="shop-pkg-count">${pkg.label}</div>
                <div class="shop-pkg-price">${price}</div>
                <button class="shop-buy-btn" id="shop-btn-${pkg.id}-${container.id}"
                        onclick="purchaseBox('${pkg.id}')">구매</button>`;
            container.appendChild(div);
        });
    });
    updateShopUI();
}

function purchaseBox(pkgId) {
    const pkg = shopData.packages.find(p => p.id === pkgId);
    if (!pkg) return;
    if (pkg.freeOnly) {
        if (freeClaimUsed) { alert('무료 수령은 1회만 가능합니다.'); return; }
        freeClaimUsed = true;
    }
    boxInventory[shopData.targetBox] += pkg.count;
    totalSpent += pkg.price;
    updateInventoryUI();
    updateShopUI();
    updateTotalCostUI();
}

// 무료 버튼 상태 반영
function updateShopUI() {
    document.querySelectorAll('[id^="shop-btn-free"]').forEach(btn => {
        btn.disabled = freeClaimUsed;
        btn.textContent = freeClaimUsed ? '수령 완료' : '수령';
    });
}


/* ──────────────────────────────────────────────
   § 9. 모달 / 드로어 (Modal & Drawer)
   ────────────────────────────────────────────── */

function openShopModal() { document.getElementById('shop-modal')?.classList.add('open'); }
function closeShopModal() { document.getElementById('shop-modal')?.classList.remove('open'); }
function openSidebar() { document.getElementById('sidebar')?.classList.add('open'); document.getElementById('sidebar-overlay')?.classList.add('open'); }
function closeSidebar() { document.getElementById('sidebar')?.classList.remove('open'); document.getElementById('sidebar-overlay')?.classList.remove('open'); }


/* ──────────────────────────────────────────────
   § 10. 로그 초기화 / 전체 초기화 (Reset)
   ────────────────────────────────────────────── */

function clearLog() {
    document.getElementById('result-log').innerHTML =
        '<p class="log-placeholder">상자를 개봉하면 기록이 나타납니다.</p>';
}

function resetAll() {
    if (!confirm('모든 진행 상황(상자·천장·수령·로그·비용)을 초기화하시겠습니까?')) return;
    for (const k in boxInventory) boxInventory[k] = 0;
    for (const k in pityCount) pityCount[k] = 0;
    for (const k in openedCount) openedCount[k] = 0;
    for (const k in altTankCount) altTankCount[k] = 0;
    Object.keys(tankLog).forEach(k => delete tankLog[k]);
    Object.keys(altConsumableCount).forEach(k => delete altConsumableCount[k]);
    // 사전 보유 항목으로 롤백
    ownedSet.clear();
    preOwnedSet.forEach(item => ownedSet.add(item));
    
    // 체크박스 UI 업데이트 (사이드바)
    document.querySelectorAll('#tanks-list .checklist-item, #cosmetics-list .checklist-item').forEach(wrap => {
        const cb = wrap.querySelector('input');
        if (!cb) return;
        const name = cb.value;
        const isChecked = preOwnedSet.has(name);
        cb.checked = isChecked;
        wrap.classList.toggle('owned', isChecked);
    });

    Object.keys(inventory).forEach(k => delete inventory[k]);
    totalOpened = 0; totalSpent = 0; freeClaimUsed = false;
    clearLog();
    updateInventoryUI(); updatePityUI(); updateStatsBar();
    updateSummaryUI(); updateTotalCostUI(); updateShopUI();
}


/* ──────────────────────────────────────────────
/* ──────────────────────────────────────────────
   § 11. 앱 시작 및 이벤트 (App Init)
   ────────────────────────────────────────────── */

document.addEventListener('DOMContentLoaded', loadData);

function openPreOwnedModal() {
    document.getElementById('preowned-modal')?.classList.add('open');
}
function closePreOwnedModal() {
    document.getElementById('preowned-modal')?.classList.remove('open');
}
function savePreOwnedAndClose() {
    try {
        localStorage.setItem('mirny_preowned', JSON.stringify([...preOwnedSet]));
        // 사전 보유 항목을 현재 보유 상태에 반영
        ownedSet.clear();
        preOwnedSet.forEach(item => ownedSet.add(item));
        // 체크리스트 UI 동기화
        document.querySelectorAll('.checklist-item input[type="checkbox"]').forEach(cb => {
            if (!cb.id.startsWith('pre_')) {
                const name = cb.value;
                cb.checked = ownedSet.has(name);
                const wrap = cb.closest('.checklist-item');
                if (wrap) wrap.classList.toggle('owned', cb.checked);
            }
        });
        closePreOwnedModal();
    } catch (e) {
        console.error('저장 실패:', e);
        alert('저장 중 오류가 발생했습니다.');
    }
}


/* ══════════════════════════════════════════════════════════
   § 추가 기능 (Enhanced Features from Patch)
   ══════════════════════════════════════════════════════════ */

/**
 * 대량 개봉 시 DOM 업데이트 최적화 (DocumentFragment 사용)
 * 기존 openBoxes 함수를 성능 개선 버전으로 대체
 */
const originalOpenBoxes = openBoxes;
function openBoxesOptimized(boxName, count) {
    if (boxInventory[boxName] < count) {
        alert(`${boxName} 상자 부족\n보유 ${boxInventory[boxName]}개 / 필요 ${count}개`);
        return;
    }
    
    boxInventory[boxName] -= count;
    const logEl = document.getElementById('result-log');
    if (totalOpened === 0) logEl.querySelector('.log-placeholder')?.remove();
    
    // DocumentFragment로 batch 처리 (성능 향상)
    const fragment = document.createDocumentFragment();
    const tempDiv = document.createElement('div');
    
    for (let i = 0; i < count; i++) {
        totalOpened++;
        openedCount[boxName]++;
        const results = simulateBox(boxName);
        
        results.forEach(r => {
            if (!r.isDud && r.name in boxInventory) boxInventory[r.name] += r.qty;
            if (r.slotId === '슬롯1' && r.isNew && !tankLog[r.name]) {
                tankLog[r.name] = { boxType: boxName, atCount: openedCount[boxName] };
            }
            if (r.slotId === '슬롯1' && r.isAlt) altTankCount[boxName]++;
            if (r.isAlt) altConsumableCount[r.name] = (altConsumableCount[r.name] || 0) + r.qty;
        });
        
        tempDiv.innerHTML = buildLogEntry(boxName, results);
        fragment.prepend(tempDiv.firstChild);
    }
    
    logEl.prepend(fragment);
    
    updateInventoryUI();
    updatePityUI();
    updateStatsBar();
    updateSummaryUI();
}

// 성능 개선 버전으로 교체 (10개 이상 개봉 시)
window.openBoxes = function(boxName, count) {
    if (count >= 10) {
        openBoxesOptimized(boxName, count);
    } else {
        originalOpenBoxes(boxName, count);
    }
};

/**
 * 통계 데이터를 JSON으로 내보내기
 */
function exportDataJSON() {
    const data = {
        timestamp: new Date().toISOString(),
        totalOpened,
        totalSpent,
        openedCount: { ...openedCount },
        boxInventory: { ...boxInventory },
        inventory: { ...inventory },
        tankLog: { ...tankLog },
        ownedItems: Array.from(ownedSet),
        pityCount: { ...pityCount }
    };
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mirny_stats_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

/**
 * 통계 데이터를 CSV로 내보내기
 */
function exportDataCSV() {
    let csv = '아이템명,수량\n';
    
    for (const [name, qty] of Object.entries(inventory)) {
        if (name !== '꽝') {
            csv += `"${name}",${qty}\n`;
        }
    }
    
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mirny_inventory_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

/**
 * 통계 요약 텍스트 생성 (복사용)
 */
function generateSummaryText() {
    let text = '=== 미르니 가챠 시뮬레이션 결과 ===\n\n';
    text += `총 개봉: ${totalOpened}개\n`;
    text += `총 지출: ${totalSpent.toLocaleString()}원\n\n`;
    
    // 상자별 개봉 수
    text += '[ 상자별 개봉 수 ]\n';
    for (const [box, count] of Object.entries(openedCount)) {
        if (count > 0) text += `${box}: ${count}개\n`;
    }
    text += '\n';
    
    // 획득 전차
    const tanks = Object.keys(tankLog);
    if (tanks.length > 0) {
        text += '[ 획득 전차 ]\n';
        tanks.forEach(name => {
            const { boxType, atCount } = tankLog[name];
            text += `${name} (${boxType} ${atCount}개째)\n`;
        });
        text += '\n';
    }
    
    // 주요 아이템
    text += '[ 주요 아이템 ]\n';
    const importantItems = ['골드', '자유 경험치', '크래딧', '프리미엄'];
    importantItems.forEach(item => {
        if (inventory[item]) {
            text += `${item}: ${inventory[item].toLocaleString()}\n`;
        }
    });
    
    text += '\n생성 일시: ' + new Date().toLocaleString('ko-KR');
    return text;
}

/**
 * 통계 텍스트 클립보드 복사
 */
async function copyStatsToClipboard() {
    try {
        const text = generateSummaryText();
        await navigator.clipboard.writeText(text);
        alert('통계가 클립보드에 복사되었습니다!');
    } catch (err) {
        console.error('클립보드 복사 실패:', err);
        // 폴백: 텍스트 영역 사용
        const textarea = document.createElement('textarea');
        textarea.value = generateSummaryText();
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        try {
            document.execCommand('copy');
            alert('통계가 클립보드에 복사되었습니다!');
        } catch (e) {
            alert('클립보드 복사에 실패했습니다.');
        }
        document.body.removeChild(textarea);
    }
}

/**
 * 확률 계산기 (특정 전차 획득 확률)
 */
function calculateProbability(tankName, boxCount) {
    const info = getTankExpected(tankName);
    if (!info) return null;
    
    const { p, C } = info;
    const expBoxes = info.expected;
    
    // 간단한 근사: 1 - (1 - 1/E)^N
    const prob = 1 - Math.pow(1 - 1/expBoxes, boxCount);
    
    return {
        tankName,
        boxCount,
        probability: prob,
        percentile: (prob * 100).toFixed(2) + '%',
        expected: Math.round(expBoxes)
    };
}

/**
 * 목표 전차까지 예상 비용 계산
 */
function calculateCostForTank(tankName) {
    const info = getTankExpected(tankName);
    if (!info || !shopData) return null;
    
    const expectedBoxes = Math.ceil(info.expected);
    const boxType = info.boxName;
    
    // 가장 효율적인 패키지 찾기 (개당 가격 기준)
    const packages = shopData.packages
        .filter(p => !p.freeOnly && p.price > 0)
        .map(p => ({
            ...p,
            pricePerBox: p.price / p.count
        }))
        .sort((a, b) => a.pricePerBox - b.pricePerBox);
    
    if (packages.length === 0) return null;
    
    const bestPackage = packages[0];
    const packagesNeeded = Math.ceil(expectedBoxes / bestPackage.count);
    const totalCost = packagesNeeded * bestPackage.price;
    const totalBoxes = packagesNeeded * bestPackage.count;
    
    return {
        tankName,
        boxType,
        expectedBoxes,
        bestPackage: bestPackage.label,
        packagesNeeded,
        totalBoxes,
        totalCost,
        costFormatted: totalCost.toLocaleString() + '원'
    };
}

/**
 * 디버그 정보 출력
 */
function debugInfo() {
    console.group('🔍 디버그 정보');
    console.log('총 개봉:', totalOpened);
    console.log('총 지출:', totalSpent);
    console.log('상자 재고:', boxInventory);
    console.log('천장 카운터:', pityCount);
    console.log('보유 아이템 수:', ownedSet.size);
    console.log('인벤토리 종류:', Object.keys(inventory).length);
    console.log('획득 전차:', Object.keys(tankLog));
    console.groupEnd();
}

// 전역 함수로 노출 (콘솔에서 사용 가능)
window.debugInfo = debugInfo;
window.calculateProbability = calculateProbability;
window.calculateCostForTank = calculateCostForTank;
window.copyStatsToClipboard = copyStatsToClipboard;
window.exportDataJSON = exportDataJSON;
window.exportDataCSV = exportDataCSV;

/**
 * 키보드 단축키 및 이벤트 리스너
 */
document.addEventListener('keydown', (e) => {
    // ESC: 모달 닫기
    if (e.key === 'Escape') {
        closeSidebar();
        closeShopModal();
        closeSummaryModal();
        closePreOwnedModal();
    }
});

// 모달 오버레이 클릭 시 닫기
document.querySelectorAll('.modal-overlay, .sidebar-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            closeSidebar();
            closeShopModal();
            closeSummaryModal();
            closePreOwnedModal();
        }
    });
});

/**
 * 에러 핸들링
 */
window.addEventListener('error', (e) => {
    console.error('전역 오류:', e.error);
});

window.addEventListener('unhandledrejection', (e) => {
    console.error('처리되지 않은 Promise 거부:', e.reason);
});

console.log('✅ 미르니 시뮬레이터 로드 완료 (통합 버전)');
console.log('📊 사용 가능한 콘솔 명령어: debugInfo(), calculateProbability(), calculateCostForTank(), copyStatsToClipboard()');
