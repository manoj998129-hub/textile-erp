// --- State & Config ---
let db = null;
let unsubscribeProduction = null;
let unsubscribeQuality = null;
let unsubscribeTaka = null;
let unsubscribeRecNo = null;

// BIM State Tracker
let machineBimStates = JSON.parse(localStorage.getItem('machine_bim_states') || '{}');

// Recent Records Pagination State
let recentRecordsCursor = [];
let currentPage = 0;
const PAGE_SIZE = 5;

// DOM Elements
const connectionStatus = document.getElementById('connection-status');
const productionForm = document.getElementById('production-form');
const qualityForm = document.getElementById('quality-form');
const recordCounter = document.getElementById('record-counter');
const dailyQualitySummary = document.getElementById('daily-quality-summary');
const notificationArea = document.getElementById('notification-area');
const recentSavesContainer = document.getElementById('recent-saves-container');
const recentSavesList = document.getElementById('recent-saves-list');

// Report Elements
const tabBtns = document.querySelectorAll('.tab-btn');
const viewSections = document.querySelectorAll('.view-section');
const reportForm = document.getElementById('report-form');
const reportList = document.getElementById('report-list');

// --- Initialization ---

function initUI() {
    // Populate Machine ID Dropdown (1-52)
    const machineSelect = document.getElementById('machine-id');
    if (machineSelect) {
        let options = '<option value="" disabled selected>Select M/C</option>';
        for (let i = 1; i <= 52; i++) {
            options += `<option value="${i}">${i}</option>`;
        }
        machineSelect.innerHTML = options;
    }

    // Form Events
    productionForm.addEventListener('submit', handleProductionSubmit);
    if(qualityForm) qualityForm.addEventListener('submit', handleQualitySubmit);
    reportForm.addEventListener('submit', handleReportSubmit);

    // Machine ID change event to auto-fill BIM status based on tracker
    document.getElementById('machine-id').addEventListener('change', handleMachineSelection);

    // Settings Tab Events
    document.getElementById('config-form').addEventListener('submit', handleConfigSubmit);
    
    // Edit Firebase settings button
    const btnEditFirebase = document.getElementById('btn-edit-firebase');
    if (btnEditFirebase) {
        btnEditFirebase.addEventListener('click', () => {
            const inputs = ['apiKey', 'authDomain', 'projectId', 'gasUrl'];
            inputs.forEach(id => {
                const el = document.getElementById(id);
                if (el) el.removeAttribute('readonly');
            });
            document.getElementById('btn-save-firebase').disabled = false;
            // Optionally focus first field
            document.getElementById('apiKey').focus();
        });
    }
    document.getElementById('taka-config-form').addEventListener('submit', handleTakaConfigSubmit);
    document.getElementById('btn-wipe').addEventListener('click', handleWipeData);
    document.getElementById('btn-backup').addEventListener('click', generateExcelBackup);

    // Tabs
    tabBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            tabBtns.forEach(b => b.classList.remove('active'));
            viewSections.forEach(s => s.classList.remove('active'));
            const targetId = e.target.dataset.target;
            e.target.classList.add('active');
            document.getElementById(targetId).classList.add('active');
            
            if (targetId === 'view-records-view') {
                loadAllRecordsView();
            }
        });
    });

    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);
    updateOnlineStatus();

    // Auth & Notes Logic
    checkAuth();
    document.getElementById('login-form').addEventListener('submit', handleLogin);
    if(document.getElementById('auth-config-form')) {
        document.getElementById('auth-config-form').addEventListener('submit', handleAuthUpdate);
    }
    loadNoteSuggestions();

    // Pagination Listeners
    document.getElementById('btn-recent-prev').addEventListener('click', () => {
        if (currentPage > 0) {
            currentPage--;
            fetchRecentRecords();
        }
    });

    document.getElementById('btn-recent-next').addEventListener('click', () => {
        currentPage++;
        fetchRecentRecords();
    });
}

function checkAuth() {
    const savedUser = localStorage.getItem('auth_user') || 'admin';
    const savedPass = localStorage.getItem('auth_pass') || 'admin';
    
    if (sessionStorage.getItem('isLoggedIn') === 'true') {
        document.getElementById('login-modal').classList.remove('show');
    }
}

function handleLogin(e) {
    e.preventDefault();
    const u = document.getElementById('login-user').value;
    const p = document.getElementById('login-pass').value;
    
    const savedUser = localStorage.getItem('auth_user') || 'admin';
    const savedPass = localStorage.getItem('auth_pass') || 'admin';

    if (u === savedUser && p === savedPass) {
        sessionStorage.setItem('isLoggedIn', 'true');
        document.getElementById('login-modal').classList.remove('show');
        document.getElementById('login-error').style.display = 'none';
        showToast('Logged in successfully', 'success');
    } else {
        document.getElementById('login-error').style.display = 'block';
    }
}

function handleAuthUpdate(e) {
    e.preventDefault();
    const nu = document.getElementById('auth-new-user').value;
    const np = document.getElementById('auth-new-pass').value;
    if (nu && np) {
        localStorage.setItem('auth_user', nu);
        localStorage.setItem('auth_pass', np);
        showToast('Credentials updated successfully', 'success');
        e.target.reset();
    }
}

function loadNoteSuggestions() {
    const notes = JSON.parse(localStorage.getItem('recent_notes') || '[]');
    const datalist = document.getElementById('note-suggestions');
    if (datalist) {
        datalist.innerHTML = notes.map(n => `<option value="${n}">`).join('');
    }
}

function saveNoteSuggestion(note) {
    if (!note) return;
    let notes = JSON.parse(localStorage.getItem('recent_notes') || '[]');
    if (!notes.includes(note)) {
        notes.unshift(note);
        if (notes.length > 20) notes.pop();
        localStorage.setItem('recent_notes', JSON.stringify(notes));
        loadNoteSuggestions();
    }
}

function updateOnlineStatus() {
    connectionStatus.textContent = navigator.onLine ? 'Online' : 'Offline';
    connectionStatus.className = navigator.onLine ? 'status-badge online' : 'status-badge offline';
}

// --- Firebase & Config ---

const DEFAULT_FIREBASE_CONFIG = {
    apiKey: "AIzaSyBJYOitiHjphiEzgZx0ni9-sTAHJyZMDWw",
    authDomain: "aarohi-production.firebaseapp.com",
    projectId: "aarohi-production",
    gasUrl: ""
};

function getFirebaseConfig() {
    const saved = localStorage.getItem('firebase_config');
    if (saved) {
        try {
            return JSON.parse(saved);
        } catch(e) {
            console.error("Invalid saved Firebase config, falling back to defaults.", e);
        }
    }
    return DEFAULT_FIREBASE_CONFIG;
}

function handleConfigSubmit(e) {
    e.preventDefault();
    const config = {
        apiKey: document.getElementById('apiKey').value,
        authDomain: document.getElementById('authDomain').value,
        projectId: document.getElementById('projectId').value,
        gasUrl: document.getElementById('gasUrl').value
    };
    localStorage.setItem('firebase_config', JSON.stringify(config));
    showToast('Config saved! Reloading...', 'success');
    setTimeout(() => window.location.reload(), 1000);
}

async function initFirebase() {
    const config = getFirebaseConfig();
    
    if (config) {
        document.getElementById('apiKey').value = config.apiKey || '';
        document.getElementById('authDomain').value = config.authDomain || '';
        document.getElementById('projectId').value = config.projectId || '';
        document.getElementById('gasUrl').value = config.gasUrl || '';
    }

    if (!config || !config.projectId) {
        showToast('Invalid Firebase Config Defaults', 'error');
        return;
    }

    try {
        if (!firebase.apps.length) {
            firebase.initializeApp(config);
        }
        db = firebase.firestore();
        try { await db.enablePersistence({ synchronizeTabs: true }); } catch (err) { console.log('Persistence error:', err); }
        startListeners();
        loadDashboardAnalytics(true);
        setInterval(() => loadDashboardAnalytics(), 60000);
        fetchRecentRecords(true);
        showToast('Connected to Database', 'success');
    } catch (error) {
        console.error("Firebase init error:", error);
        showToast('Database connection failed. Please check your config.', 'error');
    }
}

// Dashboard Caching
let dashboardCache = null;
let lastDashboardSync = 0;

async function loadDashboardAnalytics(force = false) {
    if (!db) return;
    
    const now = Date.now();
    if (!force && dashboardCache && (now - lastDashboardSync < 30000)) {
        renderDashboardAnalytics(dashboardCache);
        return;
    }

    try {
        const today = new Date(); today.setHours(0,0,0,0);
        
        const yesterdayStart = new Date(today); yesterdayStart.setDate(yesterdayStart.getDate() - 1);
        const yesterdayEnd = new Date(today); yesterdayEnd.setMilliseconds(-1);
        
        const dayBeforeStart = new Date(yesterdayStart); dayBeforeStart.setDate(dayBeforeStart.getDate() - 1);
        const dayBeforeEnd = new Date(yesterdayStart); dayBeforeEnd.setMilliseconds(-1);

        const currentMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);
        const currentMonthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59, 999);

        const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0, 23, 59, 59, 999);

        const [ySnap, dbSnap, cmSnap, lmSnap] = await Promise.all([
            db.collection('Production').where('timestamp', '>=', firebase.firestore.Timestamp.fromDate(yesterdayStart)).where('timestamp', '<=', firebase.firestore.Timestamp.fromDate(yesterdayEnd)).get(),
            db.collection('Production').where('timestamp', '>=', firebase.firestore.Timestamp.fromDate(dayBeforeStart)).where('timestamp', '<=', firebase.firestore.Timestamp.fromDate(dayBeforeEnd)).get(),
            db.collection('Production').where('timestamp', '>=', firebase.firestore.Timestamp.fromDate(currentMonthStart)).where('timestamp', '<=', firebase.firestore.Timestamp.fromDate(currentMonthEnd)).get(),
            db.collection('Production').where('timestamp', '>=', firebase.firestore.Timestamp.fromDate(lastMonthStart)).where('timestamp', '<=', firebase.firestore.Timestamp.fromDate(lastMonthEnd)).get()
        ]);

        let yTotal = 0; ySnap.forEach(d => yTotal += (d.data().meter || 0));
        let dbTotal = 0; dbSnap.forEach(d => dbTotal += (d.data().meter || 0));
        let cmTotal = 0; cmSnap.forEach(d => cmTotal += (d.data().meter || 0));
        let lmTotal = 0; lmSnap.forEach(d => lmTotal += (d.data().meter || 0));

        dashboardCache = { yTotal, dbTotal, cmTotal, lmTotal };
        lastDashboardSync = now;
        
        renderDashboardAnalytics(dashboardCache);
        
        const timeStr = new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        document.getElementById('last-sync-time').textContent = `Last updated: ${timeStr}`;
    } catch(err) {
        console.error('Error loading dashboard analytics:', err);
    }
}

window.loadDashboardAnalytics = loadDashboardAnalytics;

function renderDashboardAnalytics(data) {
    const { yTotal, dbTotal, cmTotal, lmTotal } = data;

    let compareHtml = '';
    let percentStr = '';
    if (dbTotal > 0) {
        const diff = yTotal - dbTotal;
        const pct = Math.round((Math.abs(diff) / dbTotal) * 100);
        if (diff > 0) {
            compareHtml = `<span class="indicator-increase">↑</span>`;
            percentStr = `<span class="compare-percent text-normal">+${pct}% from yesterday</span>`;
        } else if (diff < 0) {
            compareHtml = `<span class="indicator-decrease">↓</span>`;
            percentStr = `<span class="compare-percent text-danger">-${pct}% from yesterday</span>`;
        } else {
            percentStr = `<span class="compare-percent">0% from yesterday</span>`;
        }
    }

    updateElementValue('dashboard-prev-day', `<strong>${yTotal.toFixed(1)}m</strong> ${compareHtml} ${percentStr}`);
    updateElementValue('dashboard-current-month', `<strong>${cmTotal.toFixed(1)}m</strong>`);
    updateElementValue('dashboard-last-month', `<strong>${lmTotal.toFixed(1)}m</strong>`);
}

function updateElementValue(id, html) {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.innerHTML !== html) {
        el.innerHTML = html;
        el.classList.remove('value-updated');
        void el.offsetWidth;
        el.classList.add('value-updated');
    }
}

// --- Listeners & Data Loading ---

function startListeners() {
    if (!db) return;

    // Listen to Auto-Taka tracker
    unsubscribeTaka = db.collection('Config').doc('TakaTracker').onSnapshot(doc => {
        const currentTaka = (doc.exists && doc.data().nextTaka) ? doc.data().nextTaka : 1;
        document.getElementById('taka').value = currentTaka;
    });

    // Listen to RecNo tracker
    unsubscribeRecNo = db.collection('Config').doc('RecNoTracker').onSnapshot(doc => {
        const currentRecNo = (doc.exists && doc.data().nextRecNo) ? doc.data().nextRecNo : 1;
        document.getElementById('record-id').value = currentRecNo;
    });

    // Listen only to Today's records for the daily summary
    const startOfToday = new Date();
    startOfToday.setHours(0,0,0,0);

    unsubscribeProduction = db.collection('Production')
        .where('timestamp', '>=', firebase.firestore.Timestamp.fromDate(startOfToday))
        .orderBy('timestamp', 'asc')
        .onSnapshot((snapshot) => {
            let grandTotal = 0;
            snapshot.forEach(doc => {
                grandTotal += (doc.data().meter || 0);
            });
            updateElementValue('daily-quality-summary', `<strong>${grandTotal.toFixed(1)}m</strong>`);
        });

    loadQualityBreakdown(currentQualityDate);
    updateQualityDateDisplay();

    unsubscribeQuality = db.collection('QualityMaster')
        .orderBy('timestamp', 'desc')
        .onSnapshot((snapshot) => {
            let optionsHtml = '<option value="" disabled selected>Select Quality</option>';
            let reportOptionsHtml = '<option value="">All</option>';
            let tableHtml = '';

            snapshot.forEach(doc => {
                const qName = doc.data().name;
                optionsHtml += `<option value="${qName}">${qName}</option>`;
                reportOptionsHtml += `<option value="${qName}">${qName}</option>`;
                tableHtml += `
                    <tr>
                        <td data-label="Quality Name"><strong style="font-size: 1.1em;">${qName}</strong></td>
                        <td data-label="Actions" style="text-align: center;">
                            <button onclick="window.deleteQuality('${doc.id}')" class="erp-action-btn btn-delete" title="Delete">&times;</button>
                        </td>
                    </tr>
                `;
            });

            // Update dropdowns
            const prodQualitySelect = document.getElementById('quality');
            if (prodQualitySelect) {
                const currentSelected = prodQualitySelect.value;
                prodQualitySelect.innerHTML = optionsHtml;
                if (currentSelected) prodQualitySelect.value = currentSelected;
            }

            const repQualitySelect = document.getElementById('report-quality');
            if (repQualitySelect) {
                const repSelected = repQualitySelect.value;
                repQualitySelect.innerHTML = reportOptionsHtml;
                if (repSelected) repQualitySelect.value = repSelected;
            }

            // Update table
            const qualityListTable = document.getElementById('quality-list-table');
            if (qualityListTable) {
                qualityListTable.innerHTML = tableHtml || '<tr><td colspan="2" class="text-center text-muted">No qualities added yet.</td></tr>';
            }
        });
}

function resetForm() {
    productionForm.reset();
    document.getElementById('internal-doc-id').value = '';
    
    // Reset dropdown
    document.getElementById('bim-status').value = 'BIM Running';
    document.getElementById('bim-status').disabled = false;
    
    // Set Date default to today
    const dateInput = document.getElementById('entry-date');
    if (dateInput) {
        const today = new Date();
        const yyyy = today.getFullYear();
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const dd = String(today.getDate()).padStart(2, '0');
        dateInput.value = `${yyyy}-${mm}-${dd}`;
    }
    
    // Auto-fill previous values from LocalStorage
    const lastMc = localStorage.getItem('last_machine_id');
    const lastQ = localStorage.getItem('last_quality');
    
    if (lastMc) {
        document.getElementById('machine-id').value = lastMc;
        handleMachineSelection();
    } else {
        document.getElementById('machine-id').value = '';
    }
    
    if (lastQ) {
        // Wait briefly for quality options to load if it's dynamic
        setTimeout(() => {
            const qSelect = document.getElementById('quality');
            if (qSelect.querySelector(`option[value="${lastQ}"]`)) {
                qSelect.value = lastQ;
            }
        }, 100);
    }
}

// --- BIM Logic ---

function handleMachineSelection() {
    const mId = document.getElementById('machine-id').value;
    const bimSelect = document.getElementById('bim-status');
    
    if (!mId) return;

    const lastState = machineBimStates[mId];
    if (lastState === 'BIM Finish') {
        bimSelect.value = 'BIM Start';
        bimSelect.disabled = true; // Force Start
        showToast(`Machine ${mId} requires BIM Start`, 'info');
    } else {
        bimSelect.value = 'BIM Running';
        bimSelect.disabled = false;
    }
}

function updateBimTracker(machineId, status) {
    if (status === 'BIM Start') {
        machineBimStates[machineId] = 'BIM Running';
    } else {
        machineBimStates[machineId] = status;
    }
    localStorage.setItem('machine_bim_states', JSON.stringify(machineBimStates));
}

// --- Data Operations ---

async function handleProductionSubmit(e) {
    e.preventDefault();
    if (!db) return showToast('Database not connected', 'error');

    const submitBtn = document.getElementById('btn-save');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving...';

    const formData = new FormData(productionForm);
    const docId = formData.get('internalDocId');
    const machineId = formData.get('machineId');
    const bimStatus = formData.get('bimStatus') || document.getElementById('bim-status').value;

    const noteValue = formData.get('note') || '';

    const entryDateStr = formData.get('entryDate');
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const todayStr = `${yyyy}-${mm}-${dd}`;
    
    let recordTimestamp;
    if (entryDateStr === todayStr) {
        recordTimestamp = firebase.firestore.FieldValue.serverTimestamp();
    } else {
        // Backdated entry at 12:00 PM
        const [y, m, d] = entryDateStr.split('-');
        const customDate = new Date(y, m - 1, d, 12, 0, 0);
        recordTimestamp = firebase.firestore.Timestamp.fromDate(customDate);
    }

    const record = {
        machineId: machineId,
        quality: formData.get('quality'),
        meter: parseFloat(formData.get('meter')),
        bimStatus: bimStatus,
        note: noteValue
    };

    try {
        let savedId = docId;
        
        if (docId) {
            record.timestamp = recordTimestamp;
            await db.collection('Production').doc(docId).update(record);
            showToast('Record updated', 'success');
            
            record.taka = parseInt(document.getElementById('taka').value);
        } else {
            const configRefTaka = db.collection('Config').doc('TakaTracker');
            const configRefRecNo = db.collection('Config').doc('RecNoTracker');
            
            await db.runTransaction(async (transaction) => {
                const configDocTaka = await transaction.get(configRefTaka);
                const configDocRecNo = await transaction.get(configRefRecNo);
                
                let currentTaka = 1;
                if (configDocTaka.exists && configDocTaka.data().nextTaka) {
                    currentTaka = configDocTaka.data().nextTaka;
                }

                let currentRecNo = 1;
                if (configDocRecNo.exists && configDocRecNo.data().nextRecNo) {
                    currentRecNo = configDocRecNo.data().nextRecNo;
                }
                
                const newRecordRef = db.collection('Production').doc();
                
                const recordToSave = { 
                    ...record, 
                    recordId: currentRecNo,
                    taka: currentTaka, 
                    timestamp: recordTimestamp 
                };
                
                transaction.set(newRecordRef, recordToSave);
                transaction.set(configRefTaka, { nextTaka: currentTaka + 1 }, { merge: true });
                transaction.set(configRefRecNo, { nextRecNo: currentRecNo + 1 }, { merge: true });
                
                savedId = newRecordRef.id;
                record.taka = currentTaka;
                record.recordId = currentRecNo;
            });
            showToast('Record added', 'success');
        }
        
        saveNoteSuggestion(noteValue);
        localStorage.setItem('last_machine_id', machineId);
        localStorage.setItem('last_quality', record.quality);
        updateBimTracker(machineId, bimStatus);

        fetchRecentRecords(true);
        loadDashboardAnalytics(true);
        syncToGoogleSheets(record);
        cancelEdit(true); // true = focus quality
    } catch (error) {
        console.error("Save error:", error);
        showToast('Failed to save record', 'error');
    } finally {
        submitBtn.disabled = false;
        if (!document.getElementById('internal-doc-id').value) {
            submitBtn.textContent = 'Save & Sync';
        } else {
            submitBtn.textContent = 'Update & Sync';
        }
    }
}

async function fetchRecentRecords(reset = false) {
    if (!db) return;
    if (reset) {
        currentPage = 0;
        recentRecordsCursor = [];
    }

    try {
        let query = db.collection('Production').orderBy('timestamp', 'desc').limit(PAGE_SIZE);
        
        if (currentPage > 0 && recentRecordsCursor[currentPage - 1]) {
            query = query.startAfter(recentRecordsCursor[currentPage - 1]);
        }

        const snapshot = await query.get();
        const records = [];
        snapshot.forEach(doc => records.push({ id: doc.id, ...doc.data() }));
        
        if (!snapshot.empty) {
            recentRecordsCursor[currentPage] = snapshot.docs[snapshot.docs.length - 1];
        }

        renderRecentRecords(records);
        
        document.getElementById('btn-recent-prev').disabled = (currentPage === 0);
        document.getElementById('btn-recent-next').disabled = snapshot.docs.length < PAGE_SIZE;
    } catch (err) {
        console.error('Error fetching recent records:', err);
    }
}

function renderRecentRecords(records) {
    const listEl = document.getElementById('recent-saves-list');
    if (!listEl) return;

    if (records.length === 0) {
        listEl.innerHTML = '<tr><td colspan="8" class="text-center text-muted">No records found</td></tr>';
        return;
    }
    
    let html = '';
    
    records.forEach(rec => {
        let dateStr = 'Pending';
        if (rec.timestamp) {
            const d = new Date(rec.timestamp.toDate());
            dateStr = `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getFullYear()).slice(2)}`;
        }
        
        let bimClass = 'chip-running';
        if (rec.bimStatus === 'BIM Start') bimClass = 'chip-start';
        else if (rec.bimStatus === 'BIM Finish') bimClass = 'chip-finish';
        
        let bimShort = '';
        if (rec.bimStatus === 'BIM Finish') bimShort = 'F';
        else if (rec.bimStatus === 'BIM Start') bimShort = 'S';
        else if (rec.bimStatus === 'BIM Running') bimShort = 'R';
        
        html += `
            <tr>
                <td data-label="Rec No"><strong>${rec.recordId || rec.id.slice(0,5)}</strong></td>
                <td data-label="Date">${dateStr}</td>
                <td data-label="M/C No"><strong>${rec.machineId || '-'}</strong></td>
                <td data-label="Taka No"><strong>${rec.taka || '-'}</strong></td>
                <td data-label="Quality">${rec.quality || '-'}</td>
                <td data-label="Meter">${rec.meter}</td>
                <td data-label="BIM" class="font-bold text-center">${bimShort || '-'}</td>
                <td data-label="Note">${rec.note || ''}</td>
                <td data-label="Actions" style="white-space: nowrap; text-align: center;">
                    <button onclick="window.editFromView('${rec.id}')" class="erp-action-btn btn-edit" title="Edit">&#x270E;</button>
                    <button onclick="window.deleteFromView('${rec.id}')" class="erp-action-btn btn-delete" title="Delete">&times;</button>
                </td>
            </tr>
        `;
    });
    
    listEl.innerHTML = html;
}

async function handleQualitySubmit(e) {
    e.preventDefault();
    if (!db) return showToast('Database not connected', 'error');

    const input = document.getElementById('new-quality-name');
    const qName = input.value.trim().toUpperCase();
    if (!qName) return;

    try {
        await db.collection('QualityMaster').add({
            name: qName,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });
        showToast('Quality added', 'success');
        input.value = '';
    } catch (error) {
        console.error("Quality save error:", error);
        showToast('Failed to add quality', 'error');
    }
}

window.deleteQuality = async function(id) {
    if (!db || !confirm("Are you sure you want to delete this Quality?")) return;
    try {
        await db.collection('QualityMaster').doc(id).delete();
        showToast('Quality deleted', 'success');
    } catch (error) {
        console.error("Delete error:", error);
        showToast('Failed to delete', 'error');
    }
};

// --- Settings Advanced Functions ---

async function handleTakaConfigSubmit(e) {
    e.preventDefault();
    if (!db) return showToast('Database not connected', 'error');
    
    const startingTaka = parseInt(document.getElementById('starting-taka').value);
    if(isNaN(startingTaka) || startingTaka < 1) {
        showToast('Invalid Taka Number', 'error');
        return;
    }
    
    try {
        await db.collection('Config').doc('TakaTracker').set({ nextTaka: startingTaka }, { merge: true });
        showToast(`Starting Taka set to ${startingTaka}`, 'success');
        document.getElementById('starting-taka').value = '';
    } catch(err) {
        console.error(err);
        showToast('Failed to save Taka config', 'error');
    }
}

async function handleWipeData() {
    if (!db) return showToast('Database not connected', 'error');
    
    const passInput = document.getElementById('wipe-password');
    let pass = passInput.value;

    if (!pass) {
        pass = prompt('Enter admin password to confirm deletion:');
        if (pass === null) return;
    }

    if (pass !== 'table360') {
        showToast('Incorrect password', 'error');
        return;
    }
    
    if (!confirm('Are you sure? This action cannot be undone.')) return;
    
    const btn = document.getElementById('btn-wipe');
    btn.disabled = true;
    btn.textContent = 'Deleting...';
    
    try {
        const snapshot = await db.collection('Production').get();
        const qSnapshot = await db.collection('QualityMaster').get();
        
        const batch = db.batch();
        snapshot.docs.forEach((doc) => {
            batch.delete(doc.ref);
        });
        qSnapshot.docs.forEach((doc) => {
            batch.delete(doc.ref);
        });
        
        // Reset Auto-Taka
        const configRef = db.collection('Config').doc('TakaTracker');
        batch.set(configRef, { nextTaka: 1 }, { merge: true });
        
        await batch.commit();
        passInput.value = ''; // Clear the password field
        showToast('System reset: All data and qualities wiped!', 'success');
    } catch(err) {
        console.error(err);
        showToast('Failed to delete records', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = '🗑️ Delete All Data';
    }
}

async function generateExcelBackup() {
    if (!db) return showToast('Database not connected', 'error');
    if (typeof XLSX === 'undefined') return showToast('Excel library not loaded yet', 'error');

    const btn = document.getElementById('btn-backup');
    btn.disabled = true;
    btn.textContent = 'Generating Excel...';
    
    try {
        const snap = await db.collection('Production').orderBy('timestamp', 'desc').get();
        const data = [];
        
        if(snap.empty) {
            showToast('No data to backup', 'info');
            btn.disabled = false;
            btn.textContent = '📊 Backup Data to Excel';
            return;
        }

        snap.forEach(doc => {
            const d = doc.data();
            data.push({
                "Date": d.timestamp ? new Date(d.timestamp.toDate()).toLocaleString() : 'Pending',
                "M/C Number": d.machineId,
                "Quality": d.quality,
                "Meter": d.meter,
                "Taka": d.taka,
                "BIM Status": d.bimStatus,
                "Record ID": d.recordId || doc.id
            });
        });
        
        const worksheet = XLSX.utils.json_to_sheet(data);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Production Data");
        
        const fileName = `Backup_Data_${new Date().toISOString().split('T')[0]}.xlsx`;
        
        // Use SheetJS's built-in writeFile which guarantees correct extension and MIME type across devices
        XLSX.writeFile(workbook, fileName);
        
        showToast('Backup created successfully', 'success');
    } catch (err) {
        console.error(err);
        showToast('Backup generation failed', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = '📊 Backup Data to Excel';
    }
}

async function syncToGoogleSheets(record) {
    const config = getFirebaseConfig();
    if (!config || !config.gasUrl) return;

    try {
        fetch(config.gasUrl, {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(record)
        });
    } catch (error) {
        console.error("GAS Sync error:", error);
    }
}

// --- Reports Logic ---

async function handleReportSubmit(e) {
    e.preventDefault();
    if (!db) return showToast('Database not connected', 'error');

    const submitBtn = reportForm.querySelector('button');
    submitBtn.disabled = true;
    reportList.innerHTML = '<tr><td colspan="7" class="text-center">Fetching data...</td></tr>';
    document.getElementById('report-summary').style.display = 'none';

    try {
        const formData = new FormData(reportForm);
        const fromDateStr = formData.get('fromDate');
        const toDateStr = formData.get('toDate');
        const mcNum = formData.get('mcNumber');
        const qual = formData.get('quality');
        const bimStat = formData.get('bimStatus');

        let query = db.collection('Production');

        if (fromDateStr && toDateStr) {
            const fromDate = new Date(fromDateStr); fromDate.setHours(0,0,0,0);
            const toDate = new Date(toDateStr); toDate.setHours(23,59,59,999);
            query = query
                .where('timestamp', '>=', firebase.firestore.Timestamp.fromDate(fromDate))
                .where('timestamp', '<=', firebase.firestore.Timestamp.fromDate(toDate))
                .orderBy('timestamp', 'desc');
        } else {
            query = query.orderBy('timestamp', 'desc');
        }

        const snapshot = await query.get();

        let filtered = [];
        let totalMeters = 0;

        let bimStartCount = 0;
        let bimFinishCount = 0;

        snapshot.forEach(doc => {
            const data = doc.data();
            let match = true;
            if (mcNum && data.machineId !== mcNum && parseInt(data.machineId) !== parseInt(mcNum)) match = false;
            if (qual && data.quality !== qual) match = false;
            if (bimStat && data.bimStatus !== bimStat) match = false;

            if (match) {
                filtered.push({id: doc.id, ...data});
                totalMeters += (data.meter || 0);
                if (data.bimStatus === 'BIM Start') bimStartCount++;
                if (data.bimStatus === 'BIM Finish') bimFinishCount++;
            }
        });

        renderReportList(filtered, totalMeters);
        await calculateReportDailySummaries();
        
        const printDate = new Date().toLocaleString('en-US', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
        const fromToDisplay = fromDateStr ? `${fromDateStr} to ${toDateStr}` : 'All Time';
        
        document.getElementById('print-filters').innerHTML = `
            <strong>Print Date:</strong> ${printDate}<br>
            <strong>Applied Filters:</strong><br>
            Date: ${fromToDisplay} | Machine: ${mcNum || 'All'} | Quality: ${qual || 'All'} | BIM: ${bimStat || 'All'}
        `;
        
        const todayTotal = document.getElementById('summary-today-meters').textContent;
        const prevTotal = document.getElementById('summary-prev-meters').textContent;
        
        document.getElementById('print-summary-stats').innerHTML = `
            <strong>Today Total:</strong> ${todayTotal}m<br>
            <strong>Previous Day Total:</strong> ${prevTotal}m<br>
            <strong>Total Records:</strong> ${filtered.length}<br>
            <span style="color: #ef4444;">BIM Finish: ${bimFinishCount}</span> | <span style="color: #10b981;">BIM Start: ${bimStartCount}</span>
        `;

    } catch (error) {
        console.error(error);
        reportList.innerHTML = '<tr><td colspan="7" class="text-center text-danger">Error fetching data</td></tr>';
    } finally {
        submitBtn.disabled = false;
    }
}

async function loadAllRecordsView() {
    if (!db) return;
    const listEl = document.getElementById('all-records-list');
    listEl.innerHTML = '<tr><td colspan="7" class="text-center">Loading...</td></tr>';
    
    try {
        const snapshot = await db.collection('Production').orderBy('timestamp', 'desc').limit(200).get();
        if (snapshot.empty) {
            listEl.innerHTML = '<tr><td colspan="7" class="text-center text-muted">No records found</td></tr>';
            return;
        }
        
        let html = '';
        snapshot.forEach(doc => {
            const data = doc.data();
            let dateStr = 'Pending';
            if (data.timestamp) {
                const d = new Date(data.timestamp.toDate());
                dateStr = `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getFullYear()).slice(2)}`;
            }
            
            let bimShort = '';
            if (data.bimStatus === 'BIM Finish') bimShort = 'F';
            else if (data.bimStatus === 'BIM Start') bimShort = 'S';
            else if (data.bimStatus === 'BIM Running') bimShort = 'R';
            
            html += `
                <tr>
                    <td data-label="Rec No"><strong>${data.recordId || '-'}</strong></td>
                    <td data-label="Date" class="text-muted">${dateStr}</td>
                    <td data-label="M/C No"><strong>${data.machineId}</strong></td>
                    <td data-label="Taka No"><strong>${data.taka || '-'}</strong></td>
                    <td data-label="Quality">${data.quality || '-'}</td>
                    <td data-label="Meter">${data.meter}</td>
                    <td data-label="BIM" class="font-bold text-center">${bimShort || '-'}</td>
                    <td data-label="Note">${data.note || ''}</td>
                    <td data-label="Actions" style="white-space: nowrap; text-align: center;">
                        <button onclick="window.editFromView('${doc.id}')" class="erp-action-btn btn-edit" title="Edit">&#x270E;</button>
                        <button onclick="window.deleteFromView('${doc.id}')" class="erp-action-btn btn-delete" title="Delete">&times;</button>
                    </td>
                </tr>
            `;
        });
        listEl.innerHTML = html;
    } catch (err) {
        console.error(err);
        listEl.innerHTML = '<tr><td colspan="7" class="text-center text-danger">Error fetching records</td></tr>';
    }
}

window.editFromView = async function(id) {
    if (!db) return;
    try {
        const doc = await db.collection('Production').doc(id).get();
        if(doc.exists) {
            document.querySelector('.tab-btn[data-target="entry-view"]').click();
            const rec = {id: doc.id, ...doc.data()};
            
            document.getElementById('internal-doc-id').value = rec.id;
            document.getElementById('record-id').value = rec.recordId || rec.id;
            if (rec.timestamp) {
                const d = new Date(rec.timestamp.toDate());
                const yyyy = d.getFullYear();
                const mm = String(d.getMonth() + 1).padStart(2, '0');
                const dd = String(d.getDate()).padStart(2, '0');
                document.getElementById('entry-date').value = `${yyyy}-${mm}-${dd}`;
            }
            document.getElementById('machine-id').value = rec.machineId;
            document.getElementById('quality').value = rec.quality || '';
            document.getElementById('meter').value = rec.meter;
            document.getElementById('taka').value = rec.taka || '';
            document.getElementById('bim-status').value = rec.bimStatus || 'BIM Running';
            document.getElementById('note').value = rec.note || '';

            // Update UI for Edit Mode
            document.getElementById('btn-save').textContent = 'Update & Sync';
            const badge = document.getElementById('edit-badge');
            badge.classList.remove('hidden');
            badge.querySelector('span').textContent = `Editing Record #${rec.recordId || rec.id}`;
            
            // Scroll smoothly to form
            window.scrollTo({ top: 0, behavior: 'smooth' });

            showToast('Record loaded for editing', 'success');
        }
    } catch (e) {
        console.error(e);
        showToast('Error loading record', 'error');
    }
};

window.cancelEdit = function(focusQuality = false) {
    document.getElementById('internal-doc-id').value = '';
    document.getElementById('btn-save').textContent = 'Save & Sync';
    document.getElementById('edit-badge').classList.add('hidden');
    resetForm();
    if (focusQuality) {
        setTimeout(() => document.getElementById('quality').focus(), 50);
    }
};

window.deleteFromView = async function(id) {
    if (!db || !confirm("Are you sure you want to delete this record?")) return;
    try {
        await db.collection('Production').doc(id).delete();
        showToast('Record deleted', 'success');
        loadAllRecordsView(); // Refresh the list
        fetchRecentRecords(); // Refresh recent list too
        loadDashboardAnalytics(true);
    } catch (e) {
        console.error(e);
        showToast('Error deleting record', 'error');
    }
};

async function calculateReportDailySummaries() {
    const today = new Date(); today.setHours(0,0,0,0);
    const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
    
    let tTotal = 0; let yTotal = 0;
    
    const todaySnap = await db.collection('Production').where('timestamp', '>=', firebase.firestore.Timestamp.fromDate(today)).get();
    todaySnap.forEach(d => tTotal += d.data().meter || 0);
    
    const yestSnap = await db.collection('Production')
        .where('timestamp', '>=', firebase.firestore.Timestamp.fromDate(yesterday))
        .where('timestamp', '<', firebase.firestore.Timestamp.fromDate(today)).get();
    yestSnap.forEach(d => yTotal += d.data().meter || 0);

    document.getElementById('summary-today-meters').textContent = tTotal.toFixed(1);
    document.getElementById('summary-prev-meters').textContent = yTotal.toFixed(1);
}

function renderReportList(dataList, totalMeters) {
    if (dataList.length === 0) {
        reportList.innerHTML = '<tr><td colspan="8" class="text-center text-muted">No records found</td></tr>';
        document.getElementById('report-tfoot').style.display = 'none';
        return;
    }

    let html = '';
    dataList.forEach((data, index) => {
        let dateStr = 'Pending';
        if (data.timestamp) {
            const d = new Date(data.timestamp.toDate());
            dateStr = `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()} ${d.toLocaleString('en-US', {hour: '2-digit', minute:'2-digit', hour12: true})}`;
        }
        const rowClass = data.bimStatus === 'BIM Finish' ? 'bim-finish' : (data.bimStatus === 'BIM Start' ? 'bim-start' : '');
        
        html += `
            <tr class="${rowClass}">
                <td data-label="Rec No">${data.recordId || '-'}</td>
                <td data-label="Date" class="text-muted">${dateStr}</td>
                <td data-label="M/C No"><strong>${data.machineId}</strong></td>
                <td data-label="Taka No"><strong>${data.taka || '-'}</strong></td>
                <td data-label="Quality">${data.quality || '-'}</td>
                <td data-label="Meter">${data.meter}</td>
                <td data-label="Note">${data.note || '-'}</td>
                <td data-label="BIM">${data.bimStatus || '-'}</td>
            </tr>
        `;
    });

    reportList.innerHTML = html;
    document.getElementById('summary-total-meters').textContent = totalMeters.toFixed(1);
    
    const tfoot = document.getElementById('report-tfoot');
    if (tfoot) {
        tfoot.style.display = 'table-footer-group';
        document.getElementById('table-total-meters').textContent = totalMeters.toFixed(1);
    }
    
    document.getElementById('report-summary').style.display = 'grid';
}

async function handleSearchById() {
    const searchId = document.getElementById('report-search-id').value.trim();
    if (!searchId || !db) return;

    try {
        let doc = await db.collection('Production').doc(searchId).get();
        if (!doc.exists) {
            const query = await db.collection('Production').where('recordId', '==', searchId).get();
            if (!query.empty) {
                doc = query.docs[0];
            }
        }

        if (doc && doc.exists) {
            document.querySelector('.tab-btn[data-target="entry-view"]').click();
            const rec = {id: doc.id, ...doc.data()};
            
            document.getElementById('internal-doc-id').value = rec.id;
            document.getElementById('record-id').value = rec.recordId || rec.id;
            if (rec.timestamp) {
                const d = new Date(rec.timestamp.toDate());
                const yyyy = d.getFullYear();
                const mm = String(d.getMonth() + 1).padStart(2, '0');
                const dd = String(d.getDate()).padStart(2, '0');
                document.getElementById('entry-date').value = `${yyyy}-${mm}-${dd}`;
            }
            document.getElementById('machine-id').value = rec.machineId;
            document.getElementById('quality').value = rec.quality || '';
            document.getElementById('meter').value = rec.meter;
            document.getElementById('taka').value = rec.taka; // Re-populate for display
            document.getElementById('bim-status').value = rec.bimStatus || 'BIM Running';

            showToast('Record loaded for editing', 'success');
        } else {
            showToast('Record not found', 'error');
        }
    } catch (error) {
        console.error(error);
        showToast('Error searching', 'error');
    }
}

// --- Utils ---
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = message;
    notificationArea.appendChild(toast);
    setTimeout(() => {
        toast.style.animation = 'fadeOut 0.3s ease forwards';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Service worker auto-update
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').then(reg => {
            reg.addEventListener('updatefound', () => {
                const newWorker = reg.installing;
                newWorker.addEventListener('statechange', () => {
                    if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                        console.log('New update available, reloading...');
                        setTimeout(() => window.location.reload(true), 500);
                    }
                });
            });
        });
    });
}

// Start
resetForm();
initUI();
initFirebase();

// --- Quality Breakdown Date Logic ---
let currentQualityDate = new Date();
currentQualityDate.setHours(0,0,0,0);
let unsubscribeQualityBreakdown = null;

function loadQualityBreakdown(dateObj) {
    if (!db) return;
    const start = new Date(dateObj);
    const end = new Date(dateObj);
    end.setHours(23, 59, 59, 999);

    if (unsubscribeQualityBreakdown) {
        unsubscribeQualityBreakdown();
    }

    const list = document.getElementById('quality-breakdown-list');
    list.innerHTML = '<tr><td class="text-muted text-center" colspan="2"><span class="loading-skeleton w-50"></span></td></tr>';

    unsubscribeQualityBreakdown = db.collection('Production')
        .where('timestamp', '>=', firebase.firestore.Timestamp.fromDate(start))
        .where('timestamp', '<=', firebase.firestore.Timestamp.fromDate(end))
        .onSnapshot(snapshot => {
            if (snapshot.empty) {
                list.innerHTML = '<tr><td class="text-muted text-center" colspan="2">No production data available</td></tr>';
                return;
            }

            const qualityTotals = {};
            snapshot.forEach(doc => {
                const data = doc.data();
                const q = data.quality || 'Unknown';
                const m = data.meter || 0;
                if (!qualityTotals[q]) qualityTotals[q] = { meter: 0, takaCount: 0 };
                qualityTotals[q].meter += m;
                qualityTotals[q].takaCount += 1;
            });

            let breakdownHtml = '';
            let grandTotalMeters = 0;
            let grandTotalTaka = 0;
            for (const [q, stats] of Object.entries(qualityTotals)) {
                breakdownHtml += `<tr>
                    <td data-label="Quality Name"><strong>${q}</strong></td>
                    <td class="mobile-only" data-label="Total Taka" style="text-align: center;">${stats.takaCount}</td>
                    <td data-label="Total Meter Production" style="text-align: right; font-weight: bold;">${stats.meter.toFixed(1)}m</td>
                </tr>`;
                grandTotalMeters += stats.meter;
                grandTotalTaka += stats.takaCount;
            }
            
            breakdownHtml += `
                <tr style="background: rgba(0,0,0,0.02);">
                    <td data-label="Total" style="font-weight: bold; border-top: 2px solid var(--border-color) !important;">TOTAL</td>
                    <td class="mobile-only" data-label="Total Taka" style="text-align: center; font-weight: bold; border-top: 2px solid var(--border-color) !important;">${grandTotalTaka}</td>
                    <td data-label="Total Meter" style="text-align: right; font-weight: bold; color: var(--primary-color); border-top: 2px solid var(--border-color) !important; font-size: 1.1em;">${grandTotalMeters.toFixed(1)}m</td>
                </tr>
            `;
            
            list.innerHTML = breakdownHtml;
        }, err => {
            console.error('Quality breakdown error:', err);
            list.innerHTML = '<tr><td class="text-danger text-center" colspan="2">Error loading data</td></tr>';
        });
}

function updateQualityDateDisplay() {
    const display = document.getElementById('qual-date-display');
    const today = new Date(); today.setHours(0,0,0,0);
    
    if (currentQualityDate.getTime() === today.getTime()) {
        display.textContent = 'Today';
        document.getElementById('btn-qual-next').disabled = true;
    } else {
        display.textContent = currentQualityDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
        document.getElementById('btn-qual-next').disabled = false;
    }
}

document.getElementById('btn-qual-prev').addEventListener('click', () => {
    currentQualityDate.setDate(currentQualityDate.getDate() - 1);
    updateQualityDateDisplay();
    loadQualityBreakdown(currentQualityDate);
});

document.getElementById('btn-qual-next').addEventListener('click', () => {
    currentQualityDate.setDate(currentQualityDate.getDate() + 1);
    updateQualityDateDisplay();
    loadQualityBreakdown(currentQualityDate);
});

// Optimized Mobile Print Workflow
window.prepareAndPrint = function() {
    // 1. Get the target containers
    const printContainer = document.getElementById('print-container');
    const headerOriginal = document.getElementById('print-header');
    const footerOriginal = document.getElementById('print-footer');
    
    // Ensure they exist
    if (!printContainer || !headerOriginal) return;

    // 2. Extract active report list HTML without deep cloning the entire page
    const tableBodyHTML = document.getElementById('report-list').innerHTML;
    const tableFootHTML = document.getElementById('report-tfoot').innerHTML;
    
    // 3. Construct clean lightweight DOM inside print container
    printContainer.innerHTML = `
        <div class="print-header-wrapper">
            ${headerOriginal.innerHTML}
        </div>
        <div class="table-responsive">
            <table class="data-table">
                <thead>
                    <tr>
                        <th>Rec No</th>
                        <th>Date</th>
                        <th>M/C No</th>
                        <th>Taka No</th>
                        <th>Quality</th>
                        <th>Meter</th>
                        <th>Note</th>
                        <th>BIM</th>
                    </tr>
                </thead>
                <tbody>
                    ${tableBodyHTML}
                </tbody>
                <tfoot>
                    ${tableFootHTML}
                </tfoot>
            </table>
        </div>
        <div class="print-footer">
            ${footerOriginal ? footerOriginal.innerHTML : 'Generated by Aarohi Production System'}
        </div>
    `;
    
    // 4. Force browser to recalculate layouts by letting event loop tick
    setTimeout(() => {
        window.print();
        
        // 5. Cleanup memory and DOM after print dialog
        setTimeout(() => {
            printContainer.innerHTML = '';
        }, 1000);
    }, 100);
};
