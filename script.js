// グローバル変数
const API_BASE_URL = 'https://kunugida-reservation-admin-api-pv3b3g64na-an.a.run.app';
let authToken = null;
let currentTab = 'groupCall';
let currentDate = null;
let allReservations = [];
let updateInterval = null;
let selectedReservationId = null;
let currentGroupNumber = null;

// 初期化
document.addEventListener('DOMContentLoaded', () => {
    // 最初に日付を設定
    updateCurrentDate();
    // 認証チェック
    checkAuth();
    // 定期的に日付を更新
    setInterval(updateCurrentDate, 1000);
});

// 現在日時の判定
function updateCurrentDate() {
    const now = new Date();
    const dateStr = document.getElementById('currentDate');
    
    if (dateStr) {
        dateStr.textContent = now.toLocaleString('ja-JP', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    }
    
    // 営業終了判定
    const nov2End = new Date('2025-11-02T17:00:00');
    if (now >= nov2End) {
        showClosedMessage();
        return;
    }
    
    // テスト用: 現在が2025年11月以前の場合は2025-11-01として扱う
    const testDate = new Date('2025-11-01T10:00:00');
    if (now < testDate) {
        currentDate = '2025-11-01';
        return;
    }
    
    // 表示する日付の決定
    const nov1Switch = new Date('2025-11-01T17:00:00');
    if (now < nov1Switch) {
        currentDate = '2025-11-01';
    } else {
        currentDate = '2025-11-02';
    }
}

// 営業終了メッセージ表示
function showClosedMessage() {
    document.getElementById('closedMessage').style.display = 'block';
    document.querySelectorAll('.tab-content').forEach(tab => {
        if (tab.id !== 'closedMessage') {
            tab.style.display = 'none';
        }
    });
    if (updateInterval) {
        clearInterval(updateInterval);
    }
}

// ログイン
async function login() {
    const password = document.getElementById('passwordInput').value;
    
    try {
        const response = await fetch(`${API_BASE_URL}/api/admin/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ password })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            authToken = data.token;
            localStorage.setItem('adminToken', authToken);
            showMainScreen();
        } else {
            document.getElementById('loginError').style.display = 'block';
        }
    } catch (error) {
        console.error('Login error:', error);
        document.getElementById('loginError').style.display = 'block';
    }
}

// 認証チェック
function checkAuth() {
    const token = localStorage.getItem('adminToken');
    if (token) {
        authToken = token;
        showMainScreen();
    }
}

// ログアウト
function logout() {
    authToken = null;
    localStorage.removeItem('adminToken');
    document.getElementById('loginScreen').classList.add('active');
    document.getElementById('mainScreen').classList.remove('active');
    if (updateInterval) {
        clearInterval(updateInterval);
    }
}

// メイン画面表示
function showMainScreen() {
    document.getElementById('loginScreen').classList.remove('active');
    document.getElementById('mainScreen').classList.add('active');
    
    // 日付セレクタの設定
    if (currentDate) {
        document.getElementById('dateSelector').value = currentDate;
    }
    
    // データ取得開始
    loadNextGroup();
    loadSettings();
    
    // 自動更新開始(5秒ごと)
    updateInterval = setInterval(() => {
        if (currentTab === 'groupCall') {
            loadUpcomingGroups();
            loadMultiCallGroups();
            loadVipSchedule();
            loadCalledGroups();
        }
    }, 5000);
}

// 日付変更
function changeDate() {
    currentDate = document.getElementById('dateSelector').value;
    
    // 現在のタブに応じてデータを再読み込み
    switch(currentTab) {
        case 'groupCall':
            loadNextGroup();
            break;
        case 'reservations':
            loadAllReservations();
            break;
        case 'statistics':
            loadStatistics();
            break;
    }
}

// タブ切り替え
function switchTab(tabName) {
    currentTab = tabName;
    
    // タブボタンのアクティブ状態を更新
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    event.target.classList.add('active');
    
    // タブコンテンツの表示切り替え
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    document.getElementById(tabName + 'Tab').classList.add('active');
    
    // タブごとのデータ読み込み
    switch(tabName) {
        case 'groupCall':
            loadNextGroup();
            break;
        case 'reservations':
            loadAllReservations();
            break;
        case 'statistics':
            loadStatistics();
            break;
        case 'settings':
            loadSettings();
            break;
    }
}

// 次に呼び出すグループを読み込み
async function loadNextGroup() {
    try {
        if (!currentDate) {
            updateCurrentDate();
            if (!currentDate) return;
        }
        
        const response = await fetch(`${API_BASE_URL}/api/admin/next-group?date=${currentDate}`, {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });
        
        const data = await response.json();
        
        if (response.ok) {
            displayNextGroup(data);
        } else {
            console.error('Error loading next group:', data);
        }
    } catch (error) {
        console.error('Error loading next group:', error);
    }
}

// 次のグループを表示
function displayNextGroup(data) {
    const groupNumber = data.group_number;
    const reservations = data.reservations || [];
    const hasPriority = data.has_priority || false;
    
    document.getElementById('waitingGroupNumber').textContent = groupNumber || '-';
    
    const container = document.getElementById('waitingReservations');
    
    if (!groupNumber || reservations.length === 0) {
        container.innerHTML = '<p class="loading-text">次のグループはありません</p>';
        document.getElementById('callButton').disabled = true;
        currentGroupNumber = null;
        return;
    }
    
    container.innerHTML = '';
    
    // 優先予約がある場合は先頭にメッセージ表示
    if (hasPriority) {
        const priorityMsg = document.createElement('div');
        priorityMsg.style.cssText = 'background: #fff3e0; color: #f57c00; padding: 10px; border-radius: 6px; margin-bottom: 12px; font-weight: bold; font-size: 14px;';
        priorityMsg.textContent = '⚠️ 不在だった予約が含まれています（優先呼び出し）';
        container.appendChild(priorityMsg);
    }
    
    reservations.forEach(res => {
        const div = document.createElement('div');
        div.className = 'reservation-card';
        if (res.type === 'X' || res.type === 'Y') {
            div.classList.add('vip');
        }
        
        // 優先予約にマークを追加
        const priorityBadge = res.priority ? '<span style="background: #ff9800; color: #fff; padding: 2px 8px; border-radius: 4px; font-size: 11px; margin-left: 8px;">優先</span>' : '';
        
        div.innerHTML = `
            <div class="reservation-info">
                <div class="reservation-id">${res.reservation_id}${priorityBadge}</div>
                <div class="reservation-details">${res.count}人 | ${res.type}${res.time ? ' | ' + res.time : ''}</div>
            </div>
        `;
        container.appendChild(div);
    });
    
    currentGroupNumber = groupNumber;
    document.getElementById('callButton').disabled = false;
    
    // 3つの大枠を更新
    loadUpcomingGroups();
    loadMultiCallGroups();
    loadVipSchedule();
    loadCalledGroups();
}

// 呼び出し済みグループを表示（4つ目のセクション）
async function loadCalledGroups() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/admin/reservations?date=${currentDate}`, {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });
        
        const data = await response.json();
        if (!response.ok) return;
        
        const reservations = data.reservations || [];
        
        // status=1のグループを取得（呼び出し中）
        const groupMap = new Map();
        
        reservations.forEach(res => {
            if (!res.group) return;
            
            if (!groupMap.has(res.group)) {
                groupMap.set(res.group, {
                    group: res.group,
                    reservations: [],
                    isCalling: false
                });
            }
            
            const groupData = groupMap.get(res.group);
            groupData.reservations.push(res);
        });
        
        // 呼び出し中のグループを取得（group collectionでstatus=1のもの）
        const groupCollection = currentDate === '2025-11-01' ? 'group' : 'group2';
        const groupsResponse = await fetch(`${API_BASE_URL}/api/admin/calling-group?date=${currentDate}`, {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });
        
        const callingData = await groupsResponse.json();
        
        displayCalledGroups(callingData);
    } catch (error) {
        console.error('Error loading called groups:', error);
    }
}

function displayCalledGroups(data) {
    const container = document.getElementById('calledGroupsList');
    if (!container) return;
    
    container.innerHTML = '';
    
    if (!data.group_number || !data.reservations || data.reservations.length === 0) {
        container.innerHTML = '<p class="loading-text">呼び出し中のグループはありません</p>';
        return;
    }
    
    const groupNumber = data.group_number;
    const reservations = data.reservations;
    
    const groupCard = document.createElement('div');
    groupCard.className = 'called-group-card';
    
    let allVisited = true;
    reservations.forEach(res => {
        if (res.status === 0) allVisited = false;
    });
    
    if (allVisited) {
        groupCard.style.background = '#e8f5e9';
        groupCard.style.borderColor = '#4caf50';
    }
    
    const resCards = reservations.map(res => {
        let statusBadge = '';
        let cardClass = '';
        
        if (res.status === 0) {
            statusBadge = '<span style="background: #2196f3; color: #fff; padding: 3px 8px; border-radius: 4px; font-size: 11px;">待機中</span>';
            cardClass = 'status-waiting';
        } else if (res.status === 1) {
            statusBadge = '<span style="background: #4caf50; color: #fff; padding: 3px 8px; border-radius: 4px; font-size: 11px;">来店済み</span>';
            cardClass = 'status-visited';
        }
        
        const priorityBadge = res.priority ? '<span style="background: #ff9800; color: #fff; padding: 2px 6px; border-radius: 3px; font-size: 10px; margin-left: 6px;">優先</span>' : '';
        
        const buttons = res.status === 0 ? `
            <div style="display: flex; gap: 8px; margin-top: 8px;">
                <button class="btn btn-visit" style="flex: 1;" onclick="markVisit('${res.reservation_id}')">
                    来店
                </button>
                <button class="btn btn-absent" style="flex: 1;" onclick="markAbsent('${res.reservation_id}')">
                    不在
                </button>
            </div>
        ` : '';
        
        return `
            <div class="reservation-status-card ${cardClass}">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                    <div style="font-weight: bold; font-size: 15px;">${res.reservation_id}${priorityBadge}</div>
                    ${statusBadge}
                </div>
                <div style="font-size: 12px; color: #666; margin-bottom: 4px;">
                    ${res.count}名 | ${res.type}${res.time ? ' | ' + res.time : ''}
                </div>
                ${buttons}
            </div>
        `;
    }).join('');
    
    groupCard.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; padding-bottom: 12px; border-bottom: 2px solid #e0e0e0;">
            <div style="font-size: 22px; font-weight: bold;">
                グループ ${groupNumber}
            </div>
            <button class="btn" onclick="backToWaitingGroup(${groupNumber})" style="padding: 8px 16px;">
                待機中に戻す
            </button>
        </div>
        ${resCards}
    `;
    
    container.appendChild(groupCard);
}

// グループを待機中に戻す
async function backToWaitingGroup(groupNumber) {
    if (!confirm(`グループ ${groupNumber} を待機中に戻しますか?`)) {
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE_URL}/api/admin/reset-group`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                date: currentDate,
                group_number: groupNumber
            })
        });
        
        if (response.ok) {
            // 全セクションを更新
            loadUpcomingGroups();
            loadMultiCallGroups();
            loadCalledGroups();
        } else {
            alert('グループを戻すことができませんでした');
        }
    } catch (error) {
        console.error('Error resetting group:', error);
        alert('グループを戻すことができませんでした');
    }
}

// グループを呼び出す
async function callGroup() {
    if (!currentGroupNumber) return;
    
    try {
        const response = await fetch(`${API_BASE_URL}/api/admin/call-group`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                date: currentDate,
                group_number: currentGroupNumber
            })
        });
        
        if (response.ok) {
            // 呼び出し中画面へ
            document.getElementById('waitingScreen').style.display = 'none';
            document.getElementById('callingScreen').style.display = 'block';
            loadCallingGroup();
        } else {
            alert('グループの呼び出しに失敗しました');
        }
    } catch (error) {
        console.error('Error calling group:', error);
        alert('グループの呼び出しに失敗しました');
    }
}

// 呼び出し中のグループを読み込み
async function loadCallingGroup() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/admin/calling-group?date=${currentDate}`, {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });
        
        const data = await response.json();
        
        if (response.ok) {
            displayCallingGroup(data);
        } else {
            console.error('Error loading calling group:', data);
        }
    } catch (error) {
        console.error('Error loading calling group:', error);
    }
}

// 呼び出し中のグループを表示
function displayCallingGroup(data) {
    const groupNumber = data.group_number;
    const reservations = data.reservations || [];
    
    if (!groupNumber) {
        // 呼び出し中のグループがない場合は待機画面に戻る
        backToWaiting();
        return;
    }
    
    document.getElementById('callingGroupNumber').textContent = groupNumber;
    
    const container = document.getElementById('callingReservations');
    container.innerHTML = '';
    
    let allProcessed = true;
    let visitedCount = 0;
    
    reservations.forEach(res => {
        const div = document.createElement('div');
        div.className = 'reservation-card';
        
        if (res.type === 'X' || res.type === 'Y') {
            div.classList.add('vip');
        }
        
        if (res.status === 1) {
            div.classList.add('visited');
            visitedCount += res.count;
        } else {
            allProcessed = false;
        }
        
        // status=0（待機中、優先予約含む）の場合はボタンを表示
        const buttons = (res.status === 0) ? `
            <div class="reservation-actions">
                <button class="btn btn-visit" onclick="markVisit('${res.reservation_id}')">
                    来店
                </button>
                <button class="btn btn-absent" onclick="markAbsent('${res.reservation_id}')">
                    不在
                </button>
            </div>
        ` : '';
        
        // 優先予約にマークを追加
        const priorityBadge = res.priority ? '<span style="background: #ff9800; color: #fff; padding: 2px 8px; border-radius: 4px; font-size: 11px; margin-left: 8px;">優先</span>' : '';
        
        div.innerHTML = `
            <div class="reservation-info">
                <div class="reservation-id">${res.reservation_id}${priorityBadge}</div>
                <div class="reservation-details">${res.count}人 | ${res.type}${res.time ? ' | ' + res.time : ''}</div>
                ${res.status === 1 ? '<div class="reservation-details" style="color: #4caf50;">✓ 来店済み</div>' : ''}
                ${res.priority ? '<div class="reservation-details" style="color: #ff6b6b;">⚠ 不在だった予約</div>' : ''}
            </div>
            ${buttons}
        `;
        container.appendChild(div);
    });
    
    // 全て処理済みの場合は完了画面へ
    if (allProcessed) {
        showCompletedScreen(groupNumber, visitedCount);
    }
}

// 来店マーク
async function markVisit(reservationId) {
    try {
        const response = await fetch(`${API_BASE_URL}/api/admin/reservations/${reservationId}/visit`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });
        
        if (response.ok) {
            // 全セクションを更新
            loadCalledGroups();
            loadUpcomingGroups();
            loadMultiCallGroups();
        } else {
            alert('来店確認に失敗しました');
        }
    } catch (error) {
        console.error('Error marking as visited:', error);
        alert('来店確認に失敗しました');
    }
}

// 不在マーク
async function markAbsent(reservationId) {
    try {
        const response = await fetch(`${API_BASE_URL}/api/admin/reservations/${reservationId}/absent`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });
        
        if (response.ok) {
            // 不在になったら優先順位を考慮して待機中に表示されるように全セクションを更新
            loadCalledGroups();
            loadUpcomingGroups();
            loadMultiCallGroups();
        } else {
            alert('不在マークに失敗しました');
        }
    } catch (error) {
        console.error('Error marking as absent:', error);
        alert('不在マークに失敗しました');
    }
}

// 完了画面を表示
function showCompletedScreen(groupNumber, visitorCount) {
    document.getElementById('callingScreen').style.display = 'none';
    document.getElementById('completedScreen').style.display = 'block';
    
    document.getElementById('completedGroupNumber').textContent = groupNumber;
    document.getElementById('completedVisitorCount').textContent = `${visitorCount}名が入場しました`;
    
    // 3秒後に次のグループへ
    let countdown = 3;
    const countdownElem = document.getElementById('countdown');
    
    const timer = setInterval(() => {
        countdown--;
        countdownElem.textContent = `${countdown}秒後に次のグループへ...`;
        
        if (countdown <= 0) {
            clearInterval(timer);
            backToWaiting();
        }
    }, 1000);
}

// 待機画面に戻る
function backToWaiting() {
    // 呼び出し中のグループを待機中に戻す
    if (currentGroupNumber) {
        fetch(`${API_BASE_URL}/api/admin/reset-group`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                date: currentDate,
                group_number: currentGroupNumber
            })
        }).then(() => {
            document.getElementById('callingScreen').style.display = 'none';
            document.getElementById('completedScreen').style.display = 'none';
            document.getElementById('waitingScreen').style.display = 'block';
            loadNextGroup();
        });
    } else {
        document.getElementById('callingScreen').style.display = 'none';
        document.getElementById('completedScreen').style.display = 'none';
        document.getElementById('waitingScreen').style.display = 'block';
        loadNextGroup();
    }
}

// 待機中のグループ一覧を表示（priority考慮）
let displayedGroupsCount = 5;
async function loadUpcomingGroups() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/admin/reservations?date=${currentDate}`, {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });
        
        const data = await response.json();
        if (!response.ok) return;
        
        const reservations = data.reservations || [];
        
        // 呼び出し中のグループ番号を取得
        const callingGroupsResponse = await fetch(`${API_BASE_URL}/api/admin/calling-group?date=${currentDate}`, {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });
        const callingData = await callingGroupsResponse.json();
        const callingGroupNumber = callingData.group_number;
        
        // グループごとに整理（status=0のみ、かつ呼び出し中でないもの）
        const groupMap = new Map();
        
        reservations.forEach(res => {
            if (res.status !== 0 || !res.group) return;
            // 呼び出し中のグループは除外
            if (callingGroupNumber && res.group === callingGroupNumber) return;
            
            if (!groupMap.has(res.group)) {
                groupMap.set(res.group, {
                    group: res.group,
                    reservations: [],
                    hasPriority: false,
                    totalCount: 0
                });
            }
            
            const groupData = groupMap.get(res.group);
            groupData.reservations.push(res);
            groupData.totalCount += res.count;
            if (res.priority) {
                groupData.hasPriority = true;
            }
        });
        
        // グループをソート（優先フラグ優先、次にグループ番号）
        const sortedGroups = Array.from(groupMap.values())
            .sort((a, b) => {
                if (a.hasPriority && !b.hasPriority) return -1;
                if (!a.hasPriority && b.hasPriority) return 1;
                return a.group - b.group;
            });
        
        displayUpcomingGroups(sortedGroups);
    } catch (error) {
        console.error('Error loading upcoming groups:', error);
    }
}

function displayUpcomingGroups(groups) {
    const container = document.getElementById('upcomingGroupsList');
    if (!container) return;
    
    container.innerHTML = '';
    
    if (groups.length === 0) {
        container.innerHTML = '<p class="loading-text">待機中のグループはありません</p>';
        return;
    }
    
    // 表示する数だけ表示
    const toDisplay = groups.slice(0, displayedGroupsCount);
    
    toDisplay.forEach((group, index) => {
        const div = document.createElement('div');
        div.className = 'group-preview-card';
        if (group.hasPriority) {
            div.style.borderLeft = '4px solid #ff9800';
        }
        
        const priorityBadge = group.hasPriority ? '<span style="background: #ff9800; color: #fff; padding: 2px 6px; border-radius: 3px; font-size: 11px; margin-left: 8px;">優先</span>' : '';
        
        // 各予約のステータス表示
        const resDetails = group.reservations.map(r => {
            let statusText = r.status === 0 ? '待機中' : 
                           r.status === 1 ? '来店済み' : 
                           r.status === 2 ? 'キャンセル' : '';
            let statusColor = r.status === 0 ? '#2196f3' : 
                            r.status === 1 ? '#4caf50' : 
                            r.status === 2 ? '#f44336' : '#999';
            return `<div style="display: flex; justify-content: space-between; margin-top: 6px; padding: 6px 8px; background: #f8f9fa; border-radius: 4px;">
                <span style="font-weight: 600;">${r.reservation_id}</span>
                <span style="color: ${statusColor}; font-size: 12px; font-weight: 600;">${statusText}</span>
            </div>`;
        }).join('');
        
        div.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: start;">
                <div style="flex: 1;">
                    <div style="font-size: 18px; font-weight: bold; margin-bottom: 4px;">
                        グループ ${group.group}${priorityBadge}
                    </div>
                    <div style="font-size: 13px; color: #666; margin-bottom: 8px;">
                        合計 ${group.totalCount}名
                    </div>
                    ${resDetails}
                </div>
                <div style="font-size: 24px; font-weight: bold; color: #000; padding: 8px;">
                    ${index + 1}
                </div>
            </div>
            <button class="btn btn-primary" style="width: 100%; margin-top: 12px;" onclick="callSingleGroup(${group.group})">
                このグループを呼び出す
            </button>
        `;
        
        container.appendChild(div);
    });
    
    // さらに読み込むボタン
    if (groups.length > displayedGroupsCount) {
        const loadMoreBtn = document.createElement('button');
        loadMoreBtn.className = 'btn';
        loadMoreBtn.textContent = `さらに読み込む (残り${groups.length - displayedGroupsCount}グループ)`;
        loadMoreBtn.style.width = '100%';
        loadMoreBtn.onclick = () => {
            displayedGroupsCount += 5;
            displayUpcomingGroups(groups);
        };
        container.appendChild(loadMoreBtn);
    }
}

// 同時呼び出し用グループ選択
let selectedMultiCallGroups = new Set();
async function loadMultiCallGroups() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/admin/reservations?date=${currentDate}`, {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });
        
        const data = await response.json();
        if (!response.ok) return;
        
        const reservations = data.reservations || [];
        
        // 呼び出し中のグループ番号を取得
        const callingGroupsResponse = await fetch(`${API_BASE_URL}/api/admin/calling-group?date=${currentDate}`, {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });
        const callingData = await callingGroupsResponse.json();
        const callingGroupNumber = callingData.group_number;
        
        // グループごとに整理（status=0のみ、かつ呼び出し中でないもの）
        const groupMap = new Map();
        
        reservations.forEach(res => {
            if (res.status !== 0 || !res.group) return;
            // 呼び出し中のグループは除外
            if (callingGroupNumber && res.group === callingGroupNumber) return;
            
            if (!groupMap.has(res.group)) {
                groupMap.set(res.group, {
                    group: res.group,
                    reservations: [],
                    totalCount: 0
                });
            }
            
            const groupData = groupMap.get(res.group);
            groupData.reservations.push(res);
            groupData.totalCount += res.count;
        });
        
        const sortedGroups = Array.from(groupMap.values())
            .sort((a, b) => a.group - b.group);
        
        displayMultiCallGroups(sortedGroups);
    } catch (error) {
        console.error('Error loading multi-call groups:', error);
    }
}

function displayMultiCallGroups(groups) {
    const container = document.getElementById('multiCallGroupsList');
    if (!container) return;
    
    container.innerHTML = '';
    
    if (groups.length === 0) {
        container.innerHTML = '<p class="loading-text">待機中のグループはありません</p>';
        return;
    }
    
    groups.forEach(group => {
        const div = document.createElement('div');
        div.className = 'multi-call-card';
        const isSelected = selectedMultiCallGroups.has(group.group);
        if (isSelected) {
            div.style.background = '#e3f2fd';
            div.style.borderColor = '#2196f3';
        }
        
        // 各予約のステータス表示
        const resDetails = group.reservations.map(r => {
            let statusText = r.status === 0 ? '待機中' : 
                           r.status === 1 ? '来店済み' : 
                           r.status === 2 ? 'キャンセル' : '';
            let statusColor = r.status === 0 ? '#2196f3' : 
                            r.status === 1 ? '#4caf50' : 
                            r.status === 2 ? '#f44336' : '#999';
            return `<div style="display: flex; justify-content: space-between; margin-top: 4px; padding: 4px 6px; background: rgba(0,0,0,0.03); border-radius: 3px;">
                <span style="font-size: 11px; font-weight: 600;">${r.reservation_id}</span>
                <span style="color: ${statusColor}; font-size: 10px; font-weight: 600;">${statusText}</span>
            </div>`;
        }).join('');
        
        div.innerHTML = `
            <label style="display: flex; align-items: start; cursor: pointer; width: 100%;">
                <input type="checkbox" 
                       ${isSelected ? 'checked' : ''}
                       onchange="toggleMultiCallGroup(${group.group})"
                       style="width: 20px; height: 20px; margin-right: 12px; margin-top: 2px; flex-shrink: 0;">
                <div style="flex: 1;">
                    <div style="font-size: 16px; font-weight: bold; margin-bottom: 4px;">
                        グループ ${group.group}
                    </div>
                    <div style="font-size: 12px; color: #666; margin-bottom: 6px;">
                        合計 ${group.totalCount}名
                    </div>
                    ${resDetails}
                </div>
            </label>
        `;
        
        container.appendChild(div);
    });
    
    // 同時呼び出しボタン
    const callBtn = document.createElement('button');
    callBtn.className = 'btn btn-primary';
    callBtn.style.width = '100%';
    callBtn.style.marginTop = '12px';
    callBtn.textContent = `選択したグループを同時に呼び出す (${selectedMultiCallGroups.size}グループ)`;
    callBtn.disabled = selectedMultiCallGroups.size === 0;
    callBtn.onclick = callMultipleGroups;
    container.appendChild(callBtn);
}

function toggleMultiCallGroup(groupNumber) {
    if (selectedMultiCallGroups.has(groupNumber)) {
        selectedMultiCallGroups.delete(groupNumber);
    } else {
        selectedMultiCallGroups.add(groupNumber);
    }
    loadMultiCallGroups();
}

// 単一グループを呼び出す
async function callSingleGroup(groupNumber) {
    if (!confirm(`グループ ${groupNumber} を呼び出しますか?`)) {
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE_URL}/api/admin/call-group`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                date: currentDate,
                group_number: groupNumber
            })
        });
        
        if (response.ok) {
            // 呼び出し後、全セクションを更新
            loadUpcomingGroups();
            loadMultiCallGroups();
            loadCalledGroups();
        } else {
            alert('グループの呼び出しに失敗しました');
        }
    } catch (error) {
        console.error('Error calling group:', error);
        alert('グループの呼び出しに失敗しました');
    }
}

async function callMultipleGroups() {
    if (selectedMultiCallGroups.size === 0) return;
    
    if (!confirm(`${selectedMultiCallGroups.size}つのグループを同時に呼び出しますか?`)) {
        return;
    }
    
    try {
        const promises = Array.from(selectedMultiCallGroups).map(groupNum => 
            fetch(`${API_BASE_URL}/api/admin/call-group`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${authToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    date: currentDate,
                    group_number: groupNum
                })
            })
        );
        
        await Promise.all(promises);
        
        selectedMultiCallGroups.clear();
        alert('グループを呼び出しました');
        // 全セクションを更新
        loadUpcomingGroups();
        loadMultiCallGroups();
        loadCalledGroups();
    } catch (error) {
        console.error('Error calling multiple groups:', error);
        alert('グループの呼び出しに失敗しました');
    }
}

// 関係者予約スケジュール表示
async function loadVipSchedule() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/admin/reservations?date=${currentDate}`, {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });
        
        const data = await response.json();
        if (!response.ok) return;
        
        const reservations = data.reservations || [];
        
        // X/Y タイプで時刻指定があるもののみ
        const vipReservations = reservations
            .filter(res => (res.type === 'X' || res.type === 'Y') && res.time)
            .sort((a, b) => a.time.localeCompare(b.time));
        
        displayVipSchedule(vipReservations);
    } catch (error) {
        console.error('Error loading VIP schedule:', error);
    }
}

function displayVipSchedule(reservations) {
    const container = document.getElementById('vipScheduleList');
    if (!container) return;
    
    container.innerHTML = '';
    
    if (reservations.length === 0) {
        container.innerHTML = '<p class="loading-text">関係者予約はありません</p>';
        return;
    }
    
    reservations.forEach(res => {
        const div = document.createElement('div');
        div.className = 'vip-schedule-card';
        
        let statusBadge = '';
        let statusClass = '';
        
        if (res.status === 0) {
            statusBadge = '<span style="background: #4caf50; color: #fff; padding: 2px 8px; border-radius: 3px; font-size: 11px;">待機中</span>';
            statusClass = 'active';
        } else if (res.status === 1) {
            statusBadge = '<span style="background: #999; color: #fff; padding: 2px 8px; border-radius: 3px; font-size: 11px;">来店済み</span>';
            statusClass = 'completed';
        } else if (res.status === 2) {
            statusBadge = '<span style="background: #f44336; color: #fff; padding: 2px 8px; border-radius: 3px; font-size: 11px;">キャンセル</span>';
            statusClass = 'cancelled';
        }
        
        const groupInfo = res.group ? `グループ${res.group}` : '未割当';
        
        div.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: start;">
                <div style="flex: 1;">
                    <div style="font-size: 20px; font-weight: bold; margin-bottom: 4px;">
                        ${res.time}
                    </div>
                    <div style="font-size: 14px; color: #666; margin-bottom: 4px;">
                        ${res.reservation_id} | ${res.count}名 | ${groupInfo}
                    </div>
                    ${statusBadge}
                </div>
            </div>
        `;
        
        if (statusClass) {
            div.classList.add(statusClass);
        }
        
        container.appendChild(div);
    });
}

// 全予約読み込み
async function loadAllReservations() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/admin/reservations?date=${currentDate}`, {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });
        
        const data = await response.json();
        
        if (response.ok) {
            allReservations = data.reservations || [];
            displayReservations(allReservations);
        }
    } catch (error) {
        console.error('Error loading reservations:', error);
    }
}

// 予約検索
function searchReservations() {
    const searchTerm = document.getElementById('searchInput').value.toLowerCase();
    const statusFilter = document.getElementById('statusFilter').value;
    const typeFilter = document.getElementById('typeFilter').value;
    
    let filtered = allReservations;
    
    if (searchTerm) {
        filtered = filtered.filter(res => 
            res.reservation_id.toLowerCase().includes(searchTerm)
        );
    }
    
    if (statusFilter) {
        filtered = filtered.filter(res => res.status === parseInt(statusFilter));
    }
    
    if (typeFilter) {
        filtered = filtered.filter(res => res.type === typeFilter);
    }
    
    displayReservations(filtered);
}

// 予約表示
function displayReservations(reservations) {
    const tbody = document.getElementById('reservationsTableBody');
    
    if (reservations.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="empty-state">予約が見つかりません</td></tr>';
        return;
    }
    
    tbody.innerHTML = '';
    reservations.forEach(res => {
        const tr = document.createElement('tr');
        
        let statusText = res.status === 0 ? '来店前' : 
                        res.status === 1 ? '来店済み' : 
                        res.status === 2 ? 'キャンセル' : '不明';
        
        // 優先タイムアウトの場合
        if (res.status === 2 && res.cancelled_reason === 'priority_timeout') {
            statusText = 'キャンセル(優先期限切れ)';
        }
        
        const statusClass = res.status === 0 ? 'active' : 
                           res.status === 1 ? 'completed' : 
                           res.status === 2 ? 'cancelled' : '';
        
        // 優先フラグの表示
        const priorityBadge = res.priority ? ' <span style="background: #ff9800; color: #fff; padding: 2px 6px; border-radius: 3px; font-size: 10px;">優先</span>' : '';
        
        tr.innerHTML = `
            <td><strong>${res.reservation_id}</strong>${priorityBadge}</td>
            <td>${res.type}</td>
            <td>${res.count}人</td>
            <td>${res.group || '-'}</td>
            <td>${res.time || '-'}</td>
            <td><span class="status-badge ${statusClass}">${statusText}</span></td>
            <td>${new Date(res.created_at).toLocaleString('ja-JP')}</td>
            <td>
                <button class="btn" onclick="showReservationDetail('${res.reservation_id}')">詳細</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// 予約詳細表示
function showReservationDetail(reservationId) {
    const reservation = allReservations.find(r => r.reservation_id === reservationId);
    if (!reservation) return;
    
    selectedReservationId = reservationId;
    
    const modalContent = document.getElementById('modalContent');
    let statusText = reservation.status === 0 ? '来店前' : 
                    reservation.status === 1 ? '来店済み' : 
                    reservation.status === 2 ? 'キャンセル' : '不明';
    
    // 優先タイムアウトの場合
    if (reservation.status === 2 && reservation.cancelled_reason === 'priority_timeout') {
        statusText = 'キャンセル(優先期限切れ)';
    }
    
    modalContent.innerHTML = `
        <div class="form-grid">
            <div class="form-group">
                <label>予約番号</label>
                <input type="text" value="${reservation.reservation_id}" readonly>
            </div>
            <div class="form-group">
                <label>タイプ</label>
                <input type="text" value="${reservation.type}" readonly>
            </div>
            <div class="form-group">
                <label>人数</label>
                <input type="text" value="${reservation.count}人" readonly>
            </div>
            <div class="form-group">
                <label>グループ</label>
                <input type="text" value="${reservation.group || '-'}" readonly>
            </div>
            <div class="form-group">
                <label>時間</label>
                <input type="text" value="${reservation.time || '-'}" readonly>
            </div>
            <div class="form-group">
                <label>ステータス</label>
                <input type="text" value="${statusText}" readonly>
            </div>
            <div class="form-group">
                <label>作成日時</label>
                <input type="text" value="${new Date(reservation.created_at).toLocaleString('ja-JP')}" readonly>
            </div>
        </div>
    `;
    
    document.getElementById('reservationModal').classList.add('active');
}

// モーダルを閉じる
function closeModal() {
    document.getElementById('reservationModal').classList.remove('active');
    selectedReservationId = null;
}

// 予約キャンセル
async function cancelReservation() {
    if (!selectedReservationId) return;
    
    if (!confirm('この予約をキャンセルしますか?')) {
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE_URL}/api/admin/reservations/${selectedReservationId}/cancel`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });
        
        if (response.ok) {
            closeModal();
            loadAllReservations();
            alert('予約をキャンセルしました');
        } else {
            alert('キャンセルに失敗しました');
        }
    } catch (error) {
        console.error('Error cancelling reservation:', error);
        alert('キャンセルに失敗しました');
    }
}

// 時間入力の表示切り替え
function toggleTimeInput() {
    const type = document.getElementById('newResType').value;
    const timeGroup = document.getElementById('timeInputGroup');
    
    if (type === 'X' || type === 'Y') {
        timeGroup.style.display = 'block';
        document.getElementById('newResTime').required = true;
    } else {
        timeGroup.style.display = 'none';
        document.getElementById('newResTime').required = false;
    }
}

// 手動予約作成
async function createManualReservation() {
    const type = document.getElementById('newResType').value;
    const count = document.getElementById('newResCount').value;
    const time = document.getElementById('newResTime').value;
    
    if (!type || !count) {
        document.getElementById('newResError').textContent = '必須項目を入力してください';
        document.getElementById('newResError').style.display = 'block';
        return;
    }
    
    if ((type === 'X' || type === 'Y') && !time) {
        document.getElementById('newResError').textContent = '関係者予約には時刻を指定してください';
        document.getElementById('newResError').style.display = 'block';
        return;
    }
    
    const requestData = {
        type: type,
        count: parseInt(count),
        date: type === 'C' || type === 'X' ? '2025-11-01' : '2025-11-02'
    };
    
    if (type === 'X' || type === 'Y') {
        requestData.time = time;
    }
    
    try {
        const response = await fetch(`${API_BASE_URL}/api/admin/reservations/create`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestData)
        });
        
        const data = await response.json();
        
        if (response.ok) {
            document.getElementById('newResSuccess').style.display = 'block';
            document.getElementById('newResNumber').textContent = data.reservation_id;
            document.getElementById('newResError').style.display = 'none';
            document.getElementById('newReservationForm').reset();
            toggleTimeInput();
            
            setTimeout(() => {
                document.getElementById('newResSuccess').style.display = 'none';
            }, 5000);
        } else {
            document.getElementById('newResError').textContent = data.error || '予約の作成に失敗しました';
            document.getElementById('newResError').style.display = 'block';
            document.getElementById('newResSuccess').style.display = 'none';
        }
    } catch (error) {
        console.error('Error creating reservation:', error);
        document.getElementById('newResError').textContent = '予約の作成に失敗しました';
        document.getElementById('newResError').style.display = 'block';
    }
}

// 統計情報読み込み
async function loadStatistics() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/admin/statistics?date=${currentDate}`, {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });
        
        const data = await response.json();
        
        if (response.ok) {
            updateStatistics(data);
        }
    } catch (error) {
        console.error('Error loading statistics:', error);
    }
}

// 統計情報更新
function updateStatistics(data) {
    document.getElementById('statTotalReservations').textContent = data.total || 0;
    document.getElementById('statVisited').textContent = data.visited || 0;
    document.getElementById('statCancelled').textContent = data.cancelled || 0;
    document.getElementById('statWaiting').textContent = data.waiting || 0;
    
    // Chart.jsが読み込まれている場合のみグラフを表示
    if (typeof Chart !== 'undefined') {
        // タイプ別グラフ
        const typeCtx = document.getElementById('typeChart');
        if (typeCtx && data.by_type) {
            new Chart(typeCtx, {
                type: 'bar',
                data: {
                    labels: Object.keys(data.by_type),
                    datasets: [{
                        label: '予約数',
                        data: Object.values(data.by_type),
                        backgroundColor: '#000000',
                        borderColor: '#000000',
                        borderWidth: 2
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            display: false
                        }
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            ticks: {
                                stepSize: 1
                            }
                        }
                    }
                }
            });
        }
        
        // 時間別グラフ
        const timeCtx = document.getElementById('timeChart');
        if (timeCtx && data.by_hour) {
            new Chart(timeCtx, {
                type: 'line',
                data: {
                    labels: Object.keys(data.by_hour),
                    datasets: [{
                        label: '来店数',
                        data: Object.values(data.by_hour),
                        backgroundColor: 'rgba(0, 0, 0, 0.1)',
                        borderColor: '#000000',
                        borderWidth: 2,
                        fill: true
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            display: false
                        }
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            ticks: {
                                stepSize: 1
                            }
                        }
                    }
                }
            });
        }
    }
}

// 設定読み込み
async function loadSettings() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/admin/settings`, {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });
        
        const data = await response.json();
        
        if (response.ok) {
            document.getElementById('settingReception').checked = data.reception || false;
            document.getElementById('settingJoukyou').checked = data.joukyou || false;
            document.getElementById('settingJidou').checked = data.jidou || false;
        }
    } catch (error) {
        console.error('Error loading settings:', error);
    }
}

// 設定更新
async function updateSetting(key) {
    const value = document.getElementById('setting' + key.charAt(0).toUpperCase() + key.slice(1)).checked;
    
    try {
        const response = await fetch(`${API_BASE_URL}/api/admin/settings`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                key: key,
                value: value
            })
        });
        
        if (!response.ok) {
            alert('設定の更新に失敗しました');
            loadSettings(); // 元に戻す
        }
    } catch (error) {
        console.error('Error updating setting:', error);
        alert('設定の更新に失敗しました');
        loadSettings();
    }
}
