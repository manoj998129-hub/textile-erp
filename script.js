// --- State & Config ---
let db = null;
let unsubscribeProduction = null;
let unsubscribeQuality = null;
let unsubscribeTaka = null;
let unsubscribeRecNo = null;

// BIM State Tracker
let machineBimStates = JSON.parse(localStorage.getItem('machine_bim_states') || '{}');

// Recent Saves State
let recentSaves = [];
let editingRecentId = null;

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

function getFirebaseConfig() {
    return JSON.parse(localStorage.getItem('firebase_config') || 'null');
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
        showToast('Please configure Firebase in Settings Tab', 'error');
        document.querySelector('.tab-btn[data-target="settings-view"]').click();
        return;
    }

    try {
        if (!firebase.apps.length) {
            firebase.initializeApp(config);
        }
        db = firebase.firestore();
        try { await db.enablePersistence({ synchronizeTabs: true }); } catch (err) { console.log('Persistence error:', err); }
        startListeners();
        showToast('Connected to Database', 'success');
    } catch (error) {
        console.error("Firebase init error:", error);
        showToast('Database connection failed. Please check your config.', 'error');
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
            const qualityTotals = {};
            
            snapshot.forEach(doc => {
                const data = doc.data();
                const m = data.meter || 0;
                grandTotal += m;
                
                const q = data.quality || 'Unknown';
                if (!qualityTotals[q]) qualityTotals[q] = 0;
                qualityTotals[q] += m;
            });
            
            dailyQualitySummary.innerHTML = `<strong>${grandTotal.toFixed(1)}m</strong>`;
            
            let breakdownHtml = '';
            for (const [q, total] of Object.entries(qualityTotals)) {
                breakdownHtml += `<tr>
                    <td data-label="Quality" style="padding: 4px 0; color: #4b5563;"><strong>${q}</strong></td>
                    <td data-label="Total" style="padding: 4px 0; text-align: right; font-weight: bold;">${total.toFixed(1)}m</td>
                </tr>`;
            }
            if (breakdownHtml === '') breakdownHtml = '<tr><td class="text-muted py-2">No production yet today.</td></tr>';
            
            const breakdownList = document.getElementById('quality-breakdown-list');
            if(breakdownList) breakdownList.innerHTML = breakdownHtml;
        });

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
                        <td data-label="Quality Name"><strong>${qName}</strong></td>
                        <td data-label="Actions" style="text-align: center;">
                            <button onclick="window.deleteQuality('${doc.id}')" class="icon-btn text-danger" title="Delete">🗑️</button>
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
            // Updating an existing record (do not increment Taka)
            await db.collection('Production').doc(docId).update(record);
            showToast('Record updated', 'success');
            
            // Re-inject the existing taka for local array
            record.taka = parseInt(document.getElementById('taka').value);
        } else {
            // Adding a new record -> use Transaction to safely get and increment Taka & RecNo
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
                    timestamp: firebase.firestore.FieldValue.serverTimestamp() 
                };
                
                transaction.set(newRecordRef, recordToSave);
                transaction.set(configRefTaka, { nextTaka: currentTaka + 1 }, { merge: true });
                transaction.set(configRefRecNo, { nextRecNo: currentRecNo + 1 }, { merge: true });
                
                savedId = newRecordRef.id;
                record.taka = currentTaka; // Add to local object for UI
                record.recordId = currentRecNo;
            });
            showToast('Record added', 'success');
        }
        
        // Save Note to suggestions
        saveNoteSuggestion(noteValue);
        
        // Save to LocalStorage for Auto-fill
        localStorage.setItem('last_machine_id', machineId);
        localStorage.setItem('last_quality', record.quality);
        
        // Update local state tracker
        updateBimTracker(machineId, bimStatus);

        // Update Recent Saves Preview
        recentSaves.unshift({ id: savedId, ...record });
        renderRecentSaves();

        // Google Sheets Sync
        syncToGoogleSheets(record);

        resetForm();
    } catch (error) {
        console.error("Save error:", error);
        showToast('Failed to save record', 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Save & Sync';
    }
}

function renderRecentSaves() {
    if (recentSaves.length === 0) {
        recentSavesContainer.style.display = 'none';
        return;
    }
    
    recentSavesContainer.style.display = 'block';
    let html = '';
    const qOptions = document.getElementById('quality').innerHTML; // Reuse quality options
    
    recentSaves.forEach(rec => {
        if (editingRecentId === rec.id) {
            // Edit Mode
            let mcOptions = '';
            for (let i = 1; i <= 52; i++) {
                mcOptions += `<option value="${i}" ${rec.machineId == i ? 'selected' : ''}>${i}</option>`;
            }
            
            let qSelectHtml = qOptions;
            if (rec.quality) {
                qSelectHtml = qSelectHtml.replace(`value="${rec.quality}"`, `value="${rec.quality}" selected`);
            }

            html += `
                <tr>
                    <td><select id="edit-mc-${rec.id}" style="padding:4px; border-radius:4px; border:1px solid #ccc; width:60px">${mcOptions}</select></td>
                    <td><select id="edit-q-${rec.id}" style="padding:4px; border-radius:4px; border:1px solid #ccc;">${qSelectHtml}</select></td>
                    <td><input type="number" id="edit-m-${rec.id}" value="${rec.meter}" style="padding:4px; border-radius:4px; border:1px solid #ccc; width:80px"></td>
                    <td style="white-space: nowrap;">
                        <button onclick="window.saveRecentRecord('${rec.id}')" class="btn-primary btn-sm" style="margin-right:5px; padding:0.2rem 0.5rem; background-color: var(--status-normal);">Save</button>
                        <button onclick="window.cancelEditRecent()" class="btn-secondary btn-sm" style="padding:0.2rem 0.5rem;">Cancel</button>
                    </td>
                </tr>
            `;
        } else {
            // Normal View Mode
            html += `
                <tr>
                    <td data-label="M/C"><strong>${rec.machineId}</strong></td>
                    <td data-label="Quality">${rec.quality || '-'}</td>
                    <td data-label="Meter">${rec.meter}</td>
                    <td data-label="Actions" style="white-space: nowrap;">
                        <button onclick="window.editRecentRecord('${rec.id}')" class="btn-secondary btn-sm" title="Edit" style="margin-right:5px; padding:0.2rem 0.5rem; background-color: var(--primary-color); color: white;">Edit</button>
                        <button onclick="window.deleteRecentRecord('${rec.id}')" class="btn-danger btn-sm" title="Delete" style="padding:0.2rem 0.5rem;">Delete</button>
                    </td>
                </tr>
            `;
        }
    });
    
    recentSavesList.innerHTML = html;
}

window.editRecentRecord = function(id) {
    editingRecentId = id;
    renderRecentSaves();
};

window.cancelEditRecent = function() {
    editingRecentId = null;
    renderRecentSaves();
};

window.saveRecentRecord = async function(id) {
    if (!db) return;
    const newMc = document.getElementById(`edit-mc-${id}`).value;
    const newQ = document.getElementById(`edit-q-${id}`).value;
    const newM = parseFloat(document.getElementById(`edit-m-${id}`).value);
    
    if(!newMc || !newQ || isNaN(newM)) {
        showToast('Please fill all fields', 'error');
        return;
    }

    try {
        await db.collection('Production').doc(id).update({
            machineId: newMc,
            quality: newQ,
            meter: newM
        });
        showToast('Record updated', 'success');
        
        const recIndex = recentSaves.findIndex(r => r.id === id);
        if(recIndex > -1) {
            recentSaves[recIndex].machineId = newMc;
            recentSaves[recIndex].quality = newQ;
            recentSaves[recIndex].meter = newM;
        }
        editingRecentId = null;
        renderRecentSaves();
    } catch (error) {
        console.error("Update error:", error);
        showToast('Failed to update', 'error');
    }
};

window.deleteRecentRecord = async function(id) {
    if (!db || !confirm("Are you sure you want to delete this record?")) return;
    try {
        await db.collection('Production').doc(id).delete();
        showToast('Record deleted', 'success');
        
        recentSaves = recentSaves.filter(rec => rec.id !== id);
        renderRecentSaves();
    } catch (error) {
        console.error("Delete error:", error);
        showToast('Failed to delete', 'error');
    }
};

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
    const pass = passInput.value;

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
            const dateStr = data.timestamp ? new Date(data.timestamp.toDate()).toLocaleString([], {month: 'short', day: 'numeric', hour: '2-digit', minute:'2-digit'}) : 'Pending';
            
            html += `
                <tr>
                    <td data-label="Rec No">${data.recordId || '-'}</td>
                    <td data-label="Date" class="text-muted">${dateStr}</td>
                    <td data-label="M/C"><strong>${data.machineId}</strong></td>
                    <td data-label="Quality">${data.quality || '-'}</td>
                    <td data-label="Meter">${data.meter}</td>
                    <td data-label="Note">${data.note || ''}</td>
                    <td data-label="Actions" style="white-space: nowrap; text-align: center;">
                        <button onclick="window.editFromView('${doc.id}')" class="icon-btn text-primary" title="Edit">✏️</button>
                        <button onclick="window.deleteFromView('${doc.id}')" class="icon-btn text-danger" title="Delete">🗑️</button>
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
            document.querySelector('.tab-btn[data-target="dashboard-view"]').click();
            const rec = {id: doc.id, ...doc.data()};
            
            document.getElementById('internal-doc-id').value = rec.id;
            document.getElementById('record-id').value = rec.recordId || rec.id;
            document.getElementById('machine-id').value = rec.machineId;
            document.getElementById('quality').value = rec.quality || '';
            document.getElementById('meter').value = rec.meter;
            document.getElementById('taka').value = rec.taka || '';
            document.getElementById('bim-status').value = rec.bimStatus || 'BIM Running';
            document.getElementById('note').value = rec.note || '';

            showToast('Record loaded for editing', 'success');
        }
    } catch (e) {
        console.error(e);
        showToast('Error loading record', 'error');
    }
};

window.deleteFromView = async function(id) {
    if (!db || !confirm("Are you sure you want to delete this record?")) return;
    try {
        await db.collection('Production').doc(id).delete();
        showToast('Record deleted', 'success');
        loadAllRecordsView(); // Refresh the list
        // Also remove from recentSaves if present
        recentSaves = recentSaves.filter(rec => rec.id !== id);
        renderRecentSaves();
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
        const displayId = 'A' + (index + 1);
        
        html += `
            <tr class="${rowClass}">
                <td data-label="ID">${displayId}</td>
                <td data-label="Date" class="text-muted">${dateStr}</td>
                <td data-label="M/C"><strong>${data.machineId}</strong></td>
                <td data-label="Quality">${data.quality || '-'}</td>
                <td data-label="Meter">${data.meter}</td>
                <td data-label="Taka">${data.taka || '-'}</td>
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
            document.querySelector('.tab-btn[data-target="dashboard-view"]').click();
            const rec = {id: doc.id, ...doc.data()};
            
            document.getElementById('internal-doc-id').value = rec.id;
            document.getElementById('record-id').value = rec.recordId || rec.id;
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
