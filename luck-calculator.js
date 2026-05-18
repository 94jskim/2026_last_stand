// ============================================
// 운 지수 계산기
// ============================================

let gachaData = null;
let shopData = null;
let activeTabIndex = 0;
let freeBoxCount = 0;

const PITY_LIMIT = { '파편': 50, '조각': 40, '코어': 20 };
const BOX_NAMES = ['파편', '조각', '코어'];
const BOX_WEIGHTS = { '파편': 1, '조각': 6.3, '코어': 36 };
const TAB_ORDER = ['boxes', 'tanks', 'cosmetics', 'consumables', 'result'];

let inputData = {
    openedCount: { '파편': 0, '조각': 0, '코어': 0 },
    inventory: {},
    tankLog: {},
    altTankCount: { '파편': 0, '조각': 0, '코어': 0 },
    altConsumableCount: {}
};

let latestReport = null;

window.addEventListener('DOMContentLoaded', async () => {
    try {
        const [gachaRes, shopRes] = await Promise.all([
            fetch('gacha_data.json'),
            fetch('shop_data.json')
        ]);

        gachaData = await gachaRes.json();
        shopData = await shopRes.json();

        initShopPackages();
        initTankInputs();
        initCosmeticInputs();
        initConsumableInputs();
        bindLiveUpdates();
        refreshAllSummaries();
        updateNavButtons();
    } catch (err) {
        console.error('데이터 로드 실패:', err);
        alert('데이터 로드에 실패했습니다. 페이지를 새로고침해주세요.');
    }
});

function switchTab(tabName) {
    const nextIndex = TAB_ORDER.indexOf(tabName);
    if (nextIndex < 0) return;
    activeTabIndex = nextIndex;

    document.querySelectorAll('.calc-tab-pane').forEach(pane => pane.classList.remove('active'));
    document.querySelectorAll('.calc-tab').forEach(tab => tab.classList.remove('active'));

    document.getElementById(`tab-${tabName}`)?.classList.add('active');
    document.querySelector(`.calc-tab[data-tab="${tabName}"]`)?.classList.add('active');
    updateNavButtons();
}

function goPrevTab() {
    if (activeTabIndex > 0) switchTab(TAB_ORDER[activeTabIndex - 1]);
}

function goNextTab() {
    if (activeTabIndex < TAB_ORDER.length - 1) switchTab(TAB_ORDER[activeTabIndex + 1]);
}

function updateNavButtons() {
    const prev = document.getElementById('prev-tab-btn');
    const next = document.getElementById('next-tab-btn');
    if (prev) prev.disabled = activeTabIndex === 0;
    if (next) next.disabled = activeTabIndex === TAB_ORDER.length - 1;
}

function bindLiveUpdates() {
    document.addEventListener('click', event => {
        const row = event.target.closest('.input-row');
        if (!row || event.target.matches('input, button, label')) return;
        const input = row.querySelector('input[type="number"]');
        if (!input) return;
        input.focus();
        input.select();
    });

    document.addEventListener('input', event => {
        if (event.target.matches('input[type="number"]')) {
            sanitizeNumberInput(event.target);
            markReportDirty();
            refreshAllSummaries();
        }
    });

    document.addEventListener('change', event => {
        if (event.target.matches('[data-tank]')) {
            markReportDirty();
            refreshAllSummaries();
        }
    });
}

function sanitizeNumberInput(input) {
    const value = Math.max(0, parseInt(input.value, 10) || 0);
    input.value = value;
}

function initShopPackages() {
    const container = document.getElementById('shop-packages-input');
    if (!container || !shopData) return;

    container.innerHTML = '';
    shopData.packages
        .filter(pkg => !pkg.freeOnly)
        .forEach(pkg => {
            const row = document.createElement('div');
            row.className = 'package-row';
            row.innerHTML = `
                <div>
                    <div class="package-name">${pkg.label} 상자</div>
                    <div class="package-meta">${pkg.count.toLocaleString()}개 · ${pkg.price.toLocaleString()}원</div>
                </div>
                <div class="stepper" data-pkg="${pkg.id}">
                    <button type="button" aria-label="${pkg.label} 제거" onclick="changePackageCount('${pkg.id}', -1)">-</button>
                    <span class="stepper-value" id="pkg-count-${pkg.id}">0</span>
                    <button type="button" aria-label="${pkg.label} 추가" onclick="changePackageCount('${pkg.id}', 1)">+</button>
                </div>
            `;
            container.appendChild(row);
        });
}

function initTankInputs() {
    const container = document.getElementById('tank-inputs');
    if (!container || !gachaData) return;

    container.innerHTML = '';
    collectRewardItems('tank').forEach(item => {
        const id = `tank-${cssSafeId(item.name)}`;
        const row = document.createElement('div');
        row.className = 'check-row';
        row.tabIndex = 0;
        row.innerHTML = `
            <input type="checkbox" id="${id}" data-tank="${item.name}" data-box="${item.boxName}">
            <label for="${id}">${item.name}</label>
            <span class="tag">${item.boxName}</span>
        `;
        row.addEventListener('click', event => {
            if (event.target.matches('input, label')) return;
            const checkbox = row.querySelector('[data-tank]');
            checkbox.checked = !checkbox.checked;
            checkbox.dispatchEvent(new Event('change', { bubbles: true }));
        });
        row.addEventListener('keydown', event => {
            if (event.key !== ' ' && event.key !== 'Enter') return;
            event.preventDefault();
            const checkbox = row.querySelector('[data-tank]');
            checkbox.checked = !checkbox.checked;
            checkbox.dispatchEvent(new Event('change', { bubbles: true }));
        });
        container.appendChild(row);
    });
}

function initCosmeticInputs() {
    const container = document.getElementById('cosmetic-inputs');
    if (!container || !gachaData) return;

    container.innerHTML = '';
    const cosmetics = collectRewardItems('cosmetic');
    if (!cosmetics.length) {
        container.innerHTML = '<div class="result-hidden"><p>입력 가능한 치장품 데이터가 없습니다.</p></div>';
        return;
    }

    cosmetics.forEach(item => {
        const row = document.createElement('div');
        row.className = 'input-row';
        row.innerHTML = `
            <label for="cos-${cssSafeId(item.name)}">${item.name}</label>
            <span class="tag">${item.boxName}</span>
            <input type="number" id="cos-${cssSafeId(item.name)}" min="0" value="0" inputmode="numeric"
                   data-cosmetic="${item.name}">
        `;
        container.appendChild(row);
    });
}

function initConsumableInputs() {
    const container = document.getElementById('consumable-inputs');
    if (!container || !gachaData) return;

    container.innerHTML = '';
    collectRewardItems('consumable').forEach(item => {
        const row = document.createElement('div');
        row.className = 'input-row';
        row.innerHTML = `
            <label for="cons-${cssSafeId(item.name)}">${item.name}</label>
            <input type="number" id="cons-${cssSafeId(item.name)}" min="0" value="0" inputmode="numeric"
                   data-consumable="${item.name}">
        `;
        container.appendChild(row);
    });
}

function collectRewardItems(type) {
    const byName = new Map();

    BOX_NAMES.forEach(boxName => {
        const boxData = gachaData?.[boxName];
        if (!boxData?.slots) return;

        boxData.slots.forEach(slot => {
            slot.groups.forEach(group => {
                group.items.forEach(item => {
                    const isBox = BOX_NAMES.includes(item.name);
                    const isDud = item.name === '꽝';
                    const isTank = item.y && slot.id === '슬롯1';
                    const isCosmetic = item.y && slot.id !== '슬롯1';
                    const isConsumable = !item.y && !isBox && !isDud;

                    if ((type === 'tank' && isTank) ||
                        (type === 'cosmetic' && isCosmetic) ||
                        (type === 'consumable' && isConsumable)) {
                        const prev = byName.get(item.name);
                        if (!prev) byName.set(item.name, { name: item.name, boxName, slotId: slot.id });
                    }
                });
            });
        });
    });

    return [...byName.values()].sort((a, b) => {
        const boxDiff = BOX_NAMES.indexOf(a.boxName) - BOX_NAMES.indexOf(b.boxName);
        return boxDiff || a.name.localeCompare(b.name, 'ko');
    });
}

function cssSafeId(value) {
    return value.replace(/[^a-zA-Z0-9가-힣_-]/g, '-');
}

function changePackageCount(pkgId, delta) {
    const el = document.getElementById(`pkg-count-${pkgId}`);
    if (!el) return;
    const next = Math.max(0, (parseInt(el.textContent, 10) || 0) + delta);
    el.textContent = next;
    markReportDirty();
    refreshAllSummaries();
}

function getPackageCount(pkgId) {
    return parseInt(document.getElementById(`pkg-count-${pkgId}`)?.textContent, 10) || 0;
}

function addFreeBox(delta = 1) {
    freeBoxCount = Math.max(0, Math.min(10, freeBoxCount + delta));
    markReportDirty();
    updateFreeBoxUI();
    refreshAllSummaries();
}

function updateFreeBoxUI() {
    const countEl = document.getElementById('free-count');
    const removeBtn = document.getElementById('remove-free-btn');
    const addBtn = document.getElementById('add-free-btn');
    const add10Btn = document.getElementById('add-free-10-btn');

    if (countEl) countEl.textContent = freeBoxCount;
    if (removeBtn) removeBtn.disabled = freeBoxCount <= 0;
    if (addBtn) addBtn.disabled = freeBoxCount >= 10;
    if (add10Btn) add10Btn.disabled = freeBoxCount >= 10;
}

function getAltBoxes() {
    return {
        '파편': parseInt(document.getElementById('input-alt-shard')?.value, 10) || 0,
        '조각': parseInt(document.getElementById('input-alt-piece')?.value, 10) || 0,
        '코어': parseInt(document.getElementById('input-alt-core')?.value, 10) || 0
    };
}

function calculateCostFromPackages() {
    let totalCost = 0;
    let purchasedBoxes = 0;
    const packages = [];

    shopData.packages
        .filter(pkg => !pkg.freeOnly)
        .forEach(pkg => {
            const purchaseCount = getPackageCount(pkg.id);
            if (purchaseCount <= 0) return;

            const boxCount = pkg.count * purchaseCount;
            const totalPrice = pkg.price * purchaseCount;
            purchasedBoxes += boxCount;
            totalCost += totalPrice;
            packages.push({ ...pkg, purchaseCount, boxCount, totalPrice });
        });

    return { totalCost, purchasedBoxes, packages, freeBoxes: freeBoxCount };
}

function getOpenedBoxes() {
    const cost = calculateCostFromPackages();
    const altBoxes = getAltBoxes();
    return {
        '파편': cost.purchasedBoxes + freeBoxCount + altBoxes['파편'],
        '조각': altBoxes['조각'],
        '코어': altBoxes['코어']
    };
}

function refreshAllSummaries() {
    updateFreeBoxUI();
    const cost = calculateCostFromPackages();
    const altBoxes = getAltBoxes();
    const openedBoxes = getOpenedBoxes();
    const totalOpened = sumValues(openedBoxes);

    const boxSummary = document.getElementById('box-step-summary');
    if (boxSummary) boxSummary.textContent = `${totalOpened.toLocaleString()}개 개봉 · ${cost.totalCost.toLocaleString()}원`;
    setText('tab-status-boxes', `${totalOpened.toLocaleString()}개`);

    const openSummary = document.getElementById('box-open-summary');
    if (openSummary) {
        openSummary.innerHTML = `
            <div class="summary-box"><strong>${openedBoxes['파편'].toLocaleString()}</strong><span>파편 개봉</span></div>
            <div class="summary-box"><strong>${openedBoxes['조각'].toLocaleString()}</strong><span>조각 개봉</span></div>
            <div class="summary-box"><strong>${openedBoxes['코어'].toLocaleString()}</strong><span>코어 개봉</span></div>
            <div class="summary-box"><strong>${cost.totalCost.toLocaleString()}원</strong><span>총 구매 비용</span></div>
            <div class="summary-box"><strong>${cost.purchasedBoxes.toLocaleString()}</strong><span>구매 상자</span></div>
            <div class="summary-box"><strong>${sumValues(altBoxes).toLocaleString()}</strong><span>획득 상자</span></div>
        `;
    }

    const tankCount = document.querySelectorAll('[data-tank]:checked').length;
    const tankSummary = document.getElementById('tank-step-summary');
    if (tankSummary) tankSummary.textContent = `${tankCount.toLocaleString()}대 선택`;
    setText('tab-status-tanks', `${tankCount.toLocaleString()}대`);

    const cosmeticTotal = sumNodeValues('[data-cosmetic]');
    const cosmeticSummary = document.getElementById('cosmetic-step-summary');
    if (cosmeticSummary) cosmeticSummary.textContent = `${cosmeticTotal.toLocaleString()}개 입력`;
    setText('tab-status-cosmetics', `${cosmeticTotal.toLocaleString()}개`);

    const consumableTotal = sumNodeValues('[data-consumable]');
    const consumableSummary = document.getElementById('consumable-step-summary');
    if (consumableSummary) consumableSummary.textContent = `${consumableTotal.toLocaleString()}개 입력`;
    setText('tab-status-consumables', `${consumableTotal.toLocaleString()}개`);
    setText('tab-status-result', latestReport ? '완료' : '대기');
    updateReportActions();
}

function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

function sumValues(obj) {
    return Object.values(obj).reduce((sum, value) => sum + value, 0);
}

function sumNodeValues(selector) {
    return [...document.querySelectorAll(selector)]
        .reduce((sum, input) => sum + (parseInt(input.value, 10) || 0), 0);
}

function resetInputs() {
    freeBoxCount = 0;

    document.querySelectorAll('.stepper-value').forEach(el => { el.textContent = '0'; });
    document.querySelectorAll('input[type="number"]').forEach(input => { input.value = 0; });
    document.querySelectorAll('[data-tank]').forEach(input => { input.checked = false; });

    inputData = {
        openedCount: { '파편': 0, '조각': 0, '코어': 0 },
        inventory: {},
        tankLog: {},
        altTankCount: { '파편': 0, '조각': 0, '코어': 0 },
        altConsumableCount: {}
    };

    const resultContent = document.getElementById('result-content');
    const detailedStats = document.getElementById('detailed-stats');
    if (resultContent) {
        resultContent.className = 'result-hidden';
        resultContent.style.display = 'block';
        resultContent.innerHTML = '<h3>계산 대기 중</h3><p>입력 후 결과 확인을 눌러주세요</p>';
    }
    if (detailedStats) {
        detailedStats.style.display = 'none';
        detailedStats.innerHTML = '';
    }

    const modalSummary = document.getElementById('modal-summary-content');
    if (modalSummary) modalSummary.innerHTML = '';

    const resultSummary = document.getElementById('result-step-summary');
    if (resultSummary) resultSummary.textContent = '계산 대기';

    latestReport = null;

    refreshAllSummaries();
    switchTab('boxes');
}

function resetTab(tabName) {
    if (tabName === 'boxes') {
        freeBoxCount = 0;
        document.querySelectorAll('.stepper-value').forEach(el => { el.textContent = '0'; });
        ['input-alt-shard', 'input-alt-piece', 'input-alt-core'].forEach(id => {
            const input = document.getElementById(id);
            if (input) input.value = 0;
        });
    } else if (tabName === 'tanks') {
        document.querySelectorAll('[data-tank]').forEach(input => { input.checked = false; });
    } else if (tabName === 'cosmetics') {
        document.querySelectorAll('[data-cosmetic]').forEach(input => { input.value = 0; });
    } else if (tabName === 'consumables') {
        document.querySelectorAll('[data-consumable]').forEach(input => { input.value = 0; });
    }
    clearReportState();
    refreshAllSummaries();
}

function clearReportState() {
    latestReport = null;
    const resultContent = document.getElementById('result-content');
    const detailedStats = document.getElementById('detailed-stats');
    const modalSummary = document.getElementById('modal-summary-content');
    if (resultContent) {
        resultContent.className = 'result-hidden';
        resultContent.style.display = 'block';
        resultContent.innerHTML = '<h3>계산 대기 중</h3><p>입력 후 결과 확인을 눌러주세요</p>';
    }
    if (detailedStats) {
        detailedStats.style.display = 'none';
        detailedStats.innerHTML = '';
    }
    if (modalSummary) modalSummary.innerHTML = '';
    setText('result-step-summary', '계산 대기');
    updateReportActions();
}

function updateReportActions() {
    document.querySelectorAll('.report-action').forEach(button => {
        button.disabled = !latestReport;
    });
}

function markReportDirty() {
    if (!latestReport) return;
    latestReport = null;
    setText('tab-status-result', '대기');
    setText('result-step-summary', '입력 변경됨 · 다시 계산 필요');
    updateReportActions();
}

function calculateLuck() {
    if (!gachaData || !shopData) {
        alert('데이터가 아직 로드되지 않았습니다.');
        return;
    }

    const openedBoxes = getOpenedBoxes();
    const altBoxes = getAltBoxes();
    const totalBoxes = sumValues(openedBoxes);

    if (totalBoxes === 0) {
        alert('최소 1개 이상의 상자를 입력해주세요.');
        switchTab('boxes');
        return;
    }

    const inventory = {};
    const tankLog = {};
    const altTankCount = { '파편': 0, '조각': 0, '코어': 0 };
    const cosmetics = {};

    document.querySelectorAll('[data-tank]').forEach(input => {
        if (!input.checked) return;
        const tankName = input.dataset.tank;
        const boxType = input.dataset.box || '파편';
        inventory[tankName] = 1;
        tankLog[tankName] = { count: 1, boxType };
    });

    document.querySelectorAll('[data-cosmetic]').forEach(input => {
        const count = parseInt(input.value, 10) || 0;
        if (count <= 0) return;
        cosmetics[input.dataset.cosmetic] = count;
        inventory[input.dataset.cosmetic] = count;
    });

    document.querySelectorAll('[data-consumable]').forEach(input => {
        const count = parseInt(input.value, 10) || 0;
        if (count <= 0) return;
        inventory[input.dataset.consumable] = count;
    });

    BOX_NAMES.forEach(boxName => {
        inventory[boxName] = (inventory[boxName] || 0) + altBoxes[boxName];
    });

    inputData.openedCount = openedBoxes;
    inputData.inventory = inventory;
    inputData.tankLog = tankLog;
    inputData.altTankCount = altTankCount;
    inputData.altConsumableCount = {};

    const costResult = calculateCostFromPackages();
    const luckResult = calculateComprehensiveLuck();
    displayResults(openedBoxes, altBoxes, inventory, cosmetics, costResult, luckResult);
    switchTab('result');
}

function calculateComprehensiveLuck() {
    if (!gachaData) return null;

    const openedCount = inputData.openedCount;
    const inventory = inputData.inventory;
    const tankLog = inputData.tankLog;
    const altTankCount = inputData.altTankCount;

    let totalWeight = 0;
    let weightedScore = 0;

    for (const boxName in openedCount) {
        const n = openedCount[boxName];
        if (n === 0) continue;

        const slot1 = gachaData[boxName]?.slots.find(s => s.id === '슬롯1');
        const tg = slot1?.groups.find(g => g.items.some(i => i.y));
        if (!tg) continue;

        const p = tg.prob;
        const C = PITY_LIMIT[boxName];
        const expPerTank = expectedBoxesWithPity(p, 1, C);
        const expectedTanks = n / expPerTank;
        const actualTanks = Object.values(tankLog).filter(l => l.boxType === boxName).length + altTankCount[boxName];
        const ratio = actualTanks / Math.max(expectedTanks, 0.001);
        const score = Math.max(0, Math.min(1, 1 - ratio / 2));
        const weight = n * (BOX_WEIGHTS[boxName] || 1);

        weightedScore += score * weight;
        totalWeight += weight;
    }

    if (totalWeight === 0) return null;

    const tankScore = weightedScore / totalWeight;
    const consLuck = calcConsumableLuck();
    const consScore = consLuck ? consLuck.score : 0.5;

    let expectedBoxVal = 0;
    let actualBoxVal = 0;

    for (const bName in openedCount) {
        const nBox = openedCount[bName];
        if (nBox === 0 || !gachaData[bName]) continue;

        gachaData[bName].slots.forEach(slot => {
            slot.groups.forEach(group => {
                group.items.forEach(item => {
                    if (BOX_WEIGHTS[item.name]) {
                        expectedBoxVal += nBox * group.prob * item.prob * item.qty * BOX_WEIGHTS[item.name];
                    }
                });
            });
        });
    }

    for (const name in BOX_WEIGHTS) {
        actualBoxVal += (inventory[name] || 0) * BOX_WEIGHTS[name];
    }

    let boxDropScore = 0.5;
    if (expectedBoxVal > 0) {
        const boxRatio = actualBoxVal / expectedBoxVal;
        boxDropScore = Math.max(0, Math.min(1, 1 - boxRatio / 2));
    }

    const avg = tankScore * 0.75 + boxDropScore * 0.15 + consScore * 0.1;
    const top = Math.round((1 - avg) * 100);
    const bot = Math.round(avg * 100);

    let label;
    let cls;
    let detail;
    if (avg < 0.25) {
        label = `🍀 상위 ${top}%`;
        cls = 'luck-great';
        detail = '매우 운 좋음';
    } else if (avg < 0.45) {
        label = `✨ 상위 ${top}%`;
        cls = 'luck-good';
        detail = '운 좋음';
    } else if (avg < 0.55) {
        label = '⚖ 평균';
        cls = 'luck-avg';
        detail = '평균';
    } else if (avg < 0.75) {
        label = `🟡 하위 ${bot}%`;
        cls = 'luck-avg';
        detail = '운 나쁨';
    } else {
        label = `🔴 하위 ${bot}%`;
        cls = 'luck-bad';
        detail = '매우 운 나쁨';
    }

    return { score: avg, overall: avg, label, cls, detail, tankScore, boxDropScore, consScore, consLuck };
}

function calcConsumableLuck() {
    if (!gachaData) return null;

    const openedCount = inputData.openedCount;
    const inventory = inputData.inventory;
    const expectedConsumables = {};
    let hasData = false;

    for (const boxName in openedCount) {
        const n = openedCount[boxName];
        if (n === 0) continue;
        hasData = true;

        gachaData[boxName].slots.forEach(slot => {
            slot.groups.forEach(group => {
                group.items.forEach(item => {
                    if (!item.y && item.name !== '꽝') {
                        const expQty = n * group.prob * item.prob * item.qty;
                        expectedConsumables[item.name] = (expectedConsumables[item.name] || 0) + expQty;
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
        const exp = expectedConsumables[name];
        if (exp <= 0) continue;

        const act = inventory[name] || 0;
        const ratio = act / exp;
        const score = Math.max(0, Math.min(1, 1 - ratio / 2));

        if (!BOX_NAMES.includes(name)) {
            totalScore += score;
            itemCount++;
        }

        let luckCls = 'stat-luck-avg';
        let luckArrow = '⚖ 평균';
        if (ratio > 1.05) {
            luckCls = 'stat-luck-good';
            luckArrow = '⬆️ 운 좋음';
        } else if (ratio < 0.95) {
            luckCls = 'stat-luck-bad';
            luckArrow = '⬇️ 운 나쁨';
        }

        itemLuck[name] = { exp, act, ratio, score, luckCls, luckArrow };
    }

    return { score: itemCount > 0 ? totalScore / itemCount : 0.5, itemLuck };
}

function expectedBoxesWithPity(p, q, C) {
    if (p === 0) return C;
    return Math.min(q / p, C);
}

function displayResults(openedBoxes, altBoxes, inventory, cosmetics, costResult, luckResult) {
    const resultContent = document.getElementById('result-content');
    const detailedStats = document.getElementById('detailed-stats');
    const resultSummary = document.getElementById('result-step-summary');

    if (!resultContent || !detailedStats || !luckResult) return;

    const totalBoxes = sumValues(openedBoxes);
    const acquiredTanks = Object.keys(inputData.tankLog);
    const acquiredCosmetics = Object.entries(cosmetics).filter(([, count]) => count > 0);
    const acquiredConsumables = Object.entries(inventory)
        .filter(([name, count]) => count > 0 && !BOX_NAMES.includes(name) && !inputData.tankLog[name] && !cosmetics[name]);
    const generatedAt = new Date();

    latestReport = {
        generatedAt: generatedAt.toISOString(),
        openedBoxes: { ...openedBoxes },
        altBoxes: { ...altBoxes },
        inventory: { ...inventory },
        cosmetics: { ...cosmetics },
        costResult: {
            totalCost: costResult.totalCost,
            purchasedBoxes: costResult.purchasedBoxes,
            freeBoxes: costResult.freeBoxes,
            packages: costResult.packages.map(pkg => ({
                id: pkg.id,
                label: pkg.label,
                purchaseCount: pkg.purchaseCount,
                boxCount: pkg.boxCount,
                totalPrice: pkg.totalPrice
            }))
        },
        luckResult: {
            score: luckResult.score,
            label: luckResult.label,
            cls: luckResult.cls,
            detail: luckResult.detail,
            tankScore: luckResult.tankScore,
            boxDropScore: luckResult.boxDropScore,
            consScore: luckResult.consScore
        },
        tankLog: { ...inputData.tankLog }
    };

    resultContent.className = '';
    resultContent.style.display = 'block';
    resultContent.innerHTML = `
        <div class="report-board">
            <div>${buildCostHTML(costResult)}${buildLuckHTML(luckResult)}</div>
            <div class="result-card">
                <h3>보고서 요약</h3>
                ${summaryRow('생성 일시', generatedAt.toLocaleString('ko-KR'))}
                ${summaryRow('총 개봉 수', `${totalBoxes.toLocaleString()}개`)}
                ${summaryRow('총 구매 비용', `${costResult.totalCost.toLocaleString()}원`)}
                ${summaryRow('획득 전차', `${acquiredTanks.length.toLocaleString()}대`)}
                ${summaryRow('획득 치장품', `${sumValues(cosmetics).toLocaleString()}개`)}
                ${summaryRow('획득 소모품', `${acquiredConsumables.reduce((sum, [, count]) => sum + count, 0).toLocaleString()}개`)}
            </div>
        </div>
    `;

    detailedStats.style.display = 'block';
    detailedStats.className = 'report-columns';
    detailedStats.innerHTML = `
        <div class="result-card">
            <h3>개봉 통계</h3>
            ${summaryRow('총 개봉 수', `${totalBoxes.toLocaleString()}개`)}
            ${summaryRow('파편 상자', `${openedBoxes['파편'].toLocaleString()}개`)}
            ${summaryRow('조각 상자', `${openedBoxes['조각'].toLocaleString()}개`)}
            ${summaryRow('코어 상자', `${openedBoxes['코어'].toLocaleString()}개`)}
            ${summaryRow('획득 상자 합계', `${sumValues(altBoxes).toLocaleString()}개`)}
        </div>
        <div class="result-card">
            <h3>획득 전차</h3>
            ${acquiredTanks.length ? acquiredTanks.map(name => summaryRow(name, inputData.tankLog[name].boxType)).join('') : summaryRow('선택된 전차', '없음')}
        </div>
        <div class="result-card">
            <h3>획득 치장품</h3>
            ${acquiredCosmetics.length ? acquiredCosmetics.map(([name, count]) => summaryRow(name, `${count.toLocaleString()}개`)).join('') : summaryRow('입력된 치장품', '없음')}
        </div>
        <div class="result-card">
            <h3>획득 소모품</h3>
            ${acquiredConsumables.length ? acquiredConsumables.map(([name, count]) => summaryRow(name, `${count.toLocaleString()}개`)).join('') : summaryRow('입력된 소모품', '없음')}
        </div>
        ${buildConsumableLuckHTML(luckResult)}
    `;

    if (resultSummary) resultSummary.textContent = `${luckResult.label} · ${costResult.totalCost.toLocaleString()}원`;
    syncSummaryModal();
    refreshAllSummaries();
}

function buildCostHTML(costResult) {
    const packageRows = costResult.packages.length
        ? costResult.packages.map(pkg => `
            <div class="cost-row">
                <span>${pkg.label} × ${pkg.purchaseCount.toLocaleString()}</span>
                <span class="cost-value">${pkg.boxCount.toLocaleString()}개 · ${pkg.totalPrice.toLocaleString()}원</span>
            </div>
        `).join('')
        : '<div class="cost-row"><span>유료 구매</span><span class="cost-value free">없음</span></div>';

    return `
        <div class="cost-summary">
            <h3>구매 정보</h3>
            ${packageRows}
            <div class="cost-row">
                <span>무료 상자</span>
                <span class="cost-value free">${costResult.freeBoxes.toLocaleString()}개</span>
            </div>
            <div class="cost-row total">
                <span>총 구매 비용</span>
                <span class="cost-value">${costResult.totalCost.toLocaleString()}원</span>
            </div>
        </div>
    `;
}

function buildLuckHTML(luckResult) {
    const meterWidth = Math.round((1 - luckResult.score) * 100);
    return `
        <div class="luck-card">
            <div class="luck-card-title">🎲 종합 운 지수</div>
            <div class="luck-card-badge-row">
                <span class="luck-badge luck-badge-lg ${luckResult.cls}">${luckResult.label}</span>
                <span class="luck-card-detail">${luckResult.detail}</span>
            </div>
            <div class="luck-meter-wrap">
                <div class="luck-meter-track">
                    <div class="luck-meter-fill ${luckResult.cls}" style="width:${meterWidth}%"></div>
                </div>
                <div class="luck-meter-labels">
                    <span>불운</span><span>평균</span><span>행운</span>
                </div>
            </div>
            <div class="luck-card-note">
                전차 75% · 상자 드롭 15% · 소모품 10% 가중 평균
            </div>
        </div>
    `;
}

function buildConsumableLuckHTML(luckResult) {
    if (!luckResult.consLuck?.itemLuck) return '';

    const rows = Object.entries(luckResult.consLuck.itemLuck)
        .filter(([name]) => !BOX_NAMES.includes(name))
        .slice(0, 20)
        .map(([name, data]) => summaryRow(name, `${Math.round(data.act).toLocaleString()}개 / 기대 ${data.exp.toFixed(1)}`))
        .join('');

    if (!rows) return '';
    return `<div class="result-card"><h3>소모품 기대값 비교</h3>${rows}</div>`;
}

function summaryRow(label, value) {
    return `
        <div class="summary-item">
            <span>${label}</span>
            <span class="summary-item-count">${value}</span>
        </div>
    `;
}

function syncSummaryModal() {
    const modalSummary = document.getElementById('modal-summary-content');
    if (!modalSummary) return;

    if (!latestReport) {
        modalSummary.innerHTML = '<div class="result-hidden"><h3>계산 대기 중</h3><p>입력 후 결과 확인을 눌러주세요</p></div>';
        return;
    }

    modalSummary.innerHTML = buildModalSummaryReport();
}

function buildModalSummaryReport() {
    const report = latestReport;
    const luck = report.luckResult;
    const openedBoxes = report.openedBoxes;
    const inventory = report.inventory;
    const cosmetics = report.cosmetics;
    const tankLog = report.tankLog;
    const consLuck = calcConsumableLuck();
    const allYNames = new Set(collectRewardItems('tank').concat(collectRewardItems('cosmetic')).map(item => item.name));

    let html = buildLuckHTML({
        score: luck.score,
        label: luck.label,
        cls: luck.cls,
        detail: luck.detail
    });

    html += '<div class="summary-item category-header">🚀 전차</div>';
    BOX_NAMES.forEach(boxName => {
        const tanks = collectRewardItems('tank').filter(item => item.boxName === boxName);
        if (!tanks.length) return;
        html += `<div class="box-section-header">─ ${boxName} 상자 (${(openedBoxes[boxName] || 0).toLocaleString()}개 개봉) ─</div>`;
        tanks.forEach(item => {
            const owned = Boolean(tankLog[item.name]);
            const expected = getExpectedTankBoxes(item.name);
            const expText = expected ? `(기대 ${Math.round(expected).toLocaleString()}개)` : '';
            html += `
                <div class="summary-item tank-item${owned ? '' : ' not-acquired'}">
                    <span class="tank-name${owned ? '' : ' muted'}">${owned ? '✓' : '✗'} ${item.name}</span>
                    <span class="tank-meta">${owned ? boxName : ''} <span class="tank-expect-note muted">${expText}</span></span>
                </div>`;
        });
    });

    const cosmeticItems = collectRewardItems('cosmetic').filter(item => cosmetics[item.name] > 0);
    if (cosmeticItems.length) {
        html += '<div class="summary-item category-header">🎨 치장품</div>';
        BOX_NAMES.forEach(boxName => {
            const rows = cosmeticItems.filter(item => item.boxName === boxName);
            if (!rows.length) return;
            html += `<div class="box-section-header">─ ${boxName} 상자 ─</div>`;
            rows.forEach(item => {
                html += summaryRow(item.name, `${cosmetics[item.name].toLocaleString()}개`);
            });
        });
    }

    const categories = [
        { title: '💎 자원', keys: ['크래딧', '자유 경험치', '골드', '프리미엄', '부속품'] },
        { title: '📦 물자', keys: ['자경물자', '경험치 물자', '크래딧 물자', '자경물자 300', '경험치 물자 100', '크래딧 물자 100'] },
        { title: '📖 승무원 교본', keys: ['책자', '지침', '교본', '훈련교본'] },
        { title: '🗃️ 상자', keys: ['파편', '조각', '코어'] },
        { title: '⚡ 기타', keys: ['5배임무', '승무원 1', '승무원 2', '승무원 3'] }
    ];
    const remaining = new Set(Object.keys(inventory).filter(name => inventory[name] > 0 && !allYNames.has(name) && name !== '꽝'));

    categories.forEach(category => {
        const rows = category.keys.filter(name => inventory[name] > 0);
        if (!rows.length) return;
        html += `<div class="summary-item category-header">${category.title}</div>`;
        rows.forEach(name => {
            remaining.delete(name);
            html += summaryRowWithLuck(name, inventory[name], consLuck);
        });
    });

    const leftovers = [...remaining].sort((a, b) => a.localeCompare(b, 'ko'));
    if (leftovers.length) {
        html += '<div class="summary-item category-header">❓ 기타 미분류</div>';
        leftovers.forEach(name => {
            html += summaryRowWithLuck(name, inventory[name], consLuck);
        });
    }

    html += '<div class="summary-item category-header">📊 상자별 통계</div>';
    BOX_NAMES.forEach(boxName => {
        const n = openedBoxes[boxName] || 0;
        if (!n) return;
        const slot1 = gachaData[boxName]?.slots.find(slot => slot.id === '슬롯1');
        const tankGroup = slot1?.groups.find(group => group.items.some(item => item.y));
        if (!tankGroup) return;
        const expectedTanks = n / expectedBoxesWithPity(tankGroup.prob, 1, PITY_LIMIT[boxName]);
        const realTanks = Object.values(tankLog).filter(log => log.boxType === boxName).length;
        const luckCls = realTanks > expectedTanks ? 'stat-luck-good' : realTanks < expectedTanks ? 'stat-luck-bad' : 'stat-luck-avg';
        const luckText = realTanks > expectedTanks ? '⬆️ 운 좋음' : realTanks < expectedTanks ? '⬇️ 운 나쁨' : '⚖ 평균';
        html += `
            <div class="summary-item">
                <span>${boxName} ${n.toLocaleString()}개 개봉</span>
                <span class="stat-detail">전차 ${realTanks}개 <span class="${luckCls}">${luckText}</span> <span class="muted">(기대 ${expectedTanks.toFixed(1)}개)</span></span>
            </div>`;
    });

    return html;
}

function summaryRowWithLuck(name, count, consLuck) {
    let luckHtml = '';
    if (consLuck?.itemLuck?.[name]) {
        const data = consLuck.itemLuck[name];
        luckHtml = ` <span class="${data.luckCls}" style="font-size:13px; margin-left:6px;">${data.luckArrow} (기대 ${Math.round(data.exp).toLocaleString()})</span>`;
    }
    return `
        <div class="summary-item">
            <span>${name}${luckHtml}</span>
            <strong class="summary-item-count">${count.toLocaleString()}</strong>
        </div>`;
}

function getExpectedTankBoxes(tankName) {
    for (const boxName of BOX_NAMES) {
        const slot1 = gachaData[boxName]?.slots.find(slot => slot.id === '슬롯1');
        const tankGroup = slot1?.groups.find(group => group.items.some(item => item.y));
        const item = tankGroup?.items.find(candidate => candidate.y && candidate.name === tankName);
        if (!item) continue;
        const tankCount = tankGroup.items.filter(candidate => candidate.y).length || 1;
        return expectedBoxesWithPity(tankGroup.prob, 1, PITY_LIMIT[boxName]) * tankCount;
    }
    return null;
}

function openSummaryModal() {
    syncSummaryModal();
    document.getElementById('summary-modal')?.classList.add('open');
}

function closeSummaryModal() {
    document.getElementById('summary-modal')?.classList.remove('open');
}

function generateSummaryText() {
    if (!latestReport) return '계산된 운 지수 보고서가 없습니다.';

    const { openedBoxes, altBoxes, costResult, luckResult, tankLog, cosmetics, inventory, generatedAt } = latestReport;
    const consumables = Object.entries(inventory)
        .filter(([name, count]) => count > 0 && !BOX_NAMES.includes(name) && !tankLog[name] && !cosmetics[name]);

    let text = '=== 미르니 운 지수 계산 결과 ===\n\n';
    text += `생성 일시: ${new Date(generatedAt).toLocaleString('ko-KR')}\n`;
    text += `종합 운 지수: ${luckResult.label} (${luckResult.detail})\n`;
    text += `총 구매 비용: ${costResult.totalCost.toLocaleString()}원\n\n`;

    text += '[ 상자별 개봉 수 ]\n';
    BOX_NAMES.forEach(box => { text += `${box}: ${(openedBoxes[box] || 0).toLocaleString()}개\n`; });
    text += `획득 상자 합계: ${sumValues(altBoxes).toLocaleString()}개\n\n`;

    text += '[ 구매 패키지 ]\n';
    if (costResult.packages.length) {
        costResult.packages.forEach(pkg => {
            text += `${pkg.label}: ${pkg.purchaseCount.toLocaleString()}회, ${pkg.boxCount.toLocaleString()}개, ${pkg.totalPrice.toLocaleString()}원\n`;
        });
    } else {
        text += '유료 구매 없음\n';
    }
    text += `무료 상자: ${costResult.freeBoxes.toLocaleString()}개\n\n`;

    text += '[ 획득 전차 ]\n';
    const tanks = Object.entries(tankLog);
    text += tanks.length ? tanks.map(([name, data]) => `${name} (${data.boxType})`).join('\n') + '\n\n' : '없음\n\n';

    text += '[ 획득 치장품 ]\n';
    const cosmeticRows = Object.entries(cosmetics).filter(([, count]) => count > 0);
    text += cosmeticRows.length ? cosmeticRows.map(([name, count]) => `${name}: ${count.toLocaleString()}개`).join('\n') + '\n\n' : '없음\n\n';

    text += '[ 획득 소모품 ]\n';
    text += consumables.length ? consumables.map(([name, count]) => `${name}: ${count.toLocaleString()}개`).join('\n') : '없음';
    return text;
}

async function copyStatsToClipboard() {
    const text = generateSummaryText();
    try {
        await navigator.clipboard.writeText(text);
        alert('보고서가 클립보드에 복사되었습니다.');
    } catch (err) {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        try {
            document.execCommand('copy');
            alert('보고서가 클립보드에 복사되었습니다.');
        } catch (copyErr) {
            alert('클립보드 복사에 실패했습니다.');
        }
        document.body.removeChild(textarea);
    }
}

function exportDataJSON() {
    if (!latestReport) {
        alert('먼저 결과를 계산해주세요.');
        return;
    }
    downloadBlob(
        JSON.stringify(latestReport, null, 2),
        `mirny_luck_report_${Date.now()}.json`,
        'application/json'
    );
}

function exportDataCSV() {
    if (!latestReport) {
        alert('먼저 결과를 계산해주세요.');
        return;
    }

    const rows = [
        ['분류', '이름', '수량', '비고'],
        ['결과', '종합 운 지수', latestReport.luckResult.label, latestReport.luckResult.detail],
        ['비용', '총 구매 비용', latestReport.costResult.totalCost, '원']
    ];

    BOX_NAMES.forEach(box => rows.push(['개봉 상자', box, latestReport.openedBoxes[box] || 0, '개']));
    BOX_NAMES.forEach(box => rows.push(['획득 상자', box, latestReport.altBoxes[box] || 0, '개']));
    latestReport.costResult.packages.forEach(pkg => rows.push(['구매 패키지', pkg.label, pkg.purchaseCount, `${pkg.boxCount}개 / ${pkg.totalPrice}원`]));
    Object.entries(latestReport.tankLog).forEach(([name, data]) => rows.push(['전차', name, 1, data.boxType]));
    Object.entries(latestReport.cosmetics).forEach(([name, count]) => rows.push(['치장품', name, count, '개']));
    Object.entries(latestReport.inventory)
        .filter(([name, count]) => count > 0 && !BOX_NAMES.includes(name) && !latestReport.tankLog[name] && !latestReport.cosmetics[name])
        .forEach(([name, count]) => rows.push(['소모품', name, count, '개']));

    const csv = rows.map(row => row.map(csvEscape).join(',')).join('\n');
    downloadBlob('\uFEFF' + csv, `mirny_luck_report_${Date.now()}.csv`, 'text/csv;charset=utf-8;');
}

function csvEscape(value) {
    const text = String(value ?? '');
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadBlob(content, filename, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeSummaryModal();
});

window.openSummaryModal = openSummaryModal;
window.closeSummaryModal = closeSummaryModal;
window.copyStatsToClipboard = copyStatsToClipboard;
window.exportDataJSON = exportDataJSON;
window.exportDataCSV = exportDataCSV;
