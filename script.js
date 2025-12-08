const DAYS = ['Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi','Dimanche'];

    let currentSlotsByDay = [];
    let currentStaff = [];
    let currentScheduleView = 'slots'; // 'slots' | 'timeline' | 'person'

    // pour import jour (créneaux)
    let pendingDayImportIndex = null;
    // pour import jour (besoins horaires)
    let pendingNeedsDayImportIndex = null;

    // mode configuration créneaux vs besoins
    let slotsConfigMode = 'manual'; // 'manual' | 'needs'

    // besoins horaires
    let needsResolutionMinutes = 30; // 30 ou 60
    let needsByDay = []; // [dayIndex][segmentIndex] = int

    // ---------- NOTIFICATION ----------
    function showNotification(message, type = 'success') {
      const container = document.getElementById('notification-container');
      if (!container) return;

      const notification = document.createElement('div');
      notification.className = `notification ${type}`;
      notification.textContent = message;
      
      container.appendChild(notification);

      setTimeout(() => {
        notification.classList.add('show');
      }, 10);

      setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => {
          container.removeChild(notification);
        }, 300);
      }, 3000);
    }
    
    // ---------- UTIL GÉNÉRIQUE EXPORT JSON ----------
    function downloadJSON(defaultBaseName, data, descriptionForPrompt) {
      const suggested = defaultBaseName || 'export';
      const name = window.prompt(
        descriptionForPrompt + ' - nom du fichier (sans extension) :',
        suggested
      );
      if (!name) {
        return;
      }
      const fileName = name.trim() + '.json';
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }

    // ---------- STAFF : UI DYNAMIQUE ----------
    function refreshStaffDatalist(staff) {
      const dl = document.getElementById('staffDatalist');
      if (!dl) return;
      dl.innerHTML = staff.map(p => `<option value="${p.name}"></option>`).join('');
    }

    function refreshPersonViewSelect(staff) {
      const sel = document.getElementById('personViewSelect');
      if (!sel) return;
      const previous = sel.value;
      let html = '<option value="">-- choisir --</option>';
      staff.forEach(s => {
        html += `<option value="${s.name}">${s.name}</option>`;
      });
      sel.innerHTML = html;
      if (staff.some(s => s.name === previous)) {
        sel.value = previous;
      } else {
        sel.value = '';
      }
    }

    function createStaffInput(value = '') {
      const container = document.getElementById('staffTableContainer');
      if (!container) return;
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'staff-entry-input';
      input.placeholder = 'Nom';
      input.value = value;
      input.addEventListener('input', onStaffInputChange);
      container.appendChild(input);
    }

    function ensureTrailingEmptyStaffInput() {
      const container = document.getElementById('staffTableContainer');
      if (!container) return;
      const inputs = container.querySelectorAll('.staff-entry-input');
      if (!inputs.length || inputs[inputs.length - 1].value.trim() !== '') {
        createStaffInput('');
      }
    }

    function collectStaffFromDOM() {
      const container = document.getElementById('staffTableContainer');
      if (!container) return [];
      return Array.from(container.querySelectorAll('.staff-entry-input'))
        .map(i => i.value.trim())
        .filter(v => v)
        .map(name => ({ name }));
    }

    function updateStaffModelAndUI() {
      const staff = collectStaffFromDOM();
      currentStaff = staff;
      const countInput = document.getElementById('staffCount');
      if (countInput) {
        countInput.value = staff.length;
      }
      refreshStaffDatalist(staff);
      refreshPersonViewSelect(staff);
      updateStats();
    }

    function onStaffInputChange() {
      ensureTrailingEmptyStaffInput();
      updateStaffModelAndUI();
      saveStateToLocalStorage();
    }

    function initStaffUI() {
      const container = document.getElementById('staffTableContainer');
      if (!container) return;
      container.innerHTML = '';
      createStaffInput('');
      ensureTrailingEmptyStaffInput();
      updateStaffModelAndUI();
    }

    function resetStaff() {
      const container = document.getElementById('staffTableContainer');
      if (container) {
        container.innerHTML = '';
      }
      currentStaff = [];
      const countInput = document.getElementById('staffCount');
      if (countInput) {
        countInput.value = 0;
      }
      refreshStaffDatalist([]);
      refreshPersonViewSelect([]);
      if (container) {
        createStaffInput('');
        ensureTrailingEmptyStaffInput();
      }
      updateStats();
      saveStateToLocalStorage();
    }

    function getStaff() {
      updateStaffModelAndUI();
      return currentStaff;
    }

    function exportStaff() {
      const staff = getStaff();
      if (!staff.length) {
        showNotification("Aucun membre du staff à exporter.", "error");
        return;
      }
      const data = {
        type: "staffList",
        staff: staff.map(s => ({ name: s.name }))
      };
      downloadJSON("staff", data, "Exporter la liste du staff");
    }

    function handleImportStaffFile(event) {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = function(e) {
        try {
          const data = JSON.parse(e.target.result);
          if (!data || !Array.isArray(data.staff)) {
            showNotification("Fichier staff invalide (champ 'staff' manquant ou incorrect).", "error");
            return;
          }
          const staffArray = data.staff.map(s => {
            if (typeof s === 'string') return { name: s };
            if (s && typeof s.name === 'string') return { name: s.name };
            return null;
          }).filter(Boolean);

          if (!staffArray.length) {
            showNotification("Fichier staff invalide (aucun nom valide).", "error");
            return;
          }

          const container = document.getElementById('staffTableContainer');
          if (!container) return;
          container.innerHTML = '';
          staffArray.forEach(s => createStaffInput(s.name));
          ensureTrailingEmptyStaffInput();
          updateStaffModelAndUI();
          saveStateToLocalStorage();
          showNotification("Liste du staff importée avec succès !");
        } catch (err) {
          console.error(err);
          showNotification("Erreur lors de la lecture du fichier staff.", "error");
        } finally {
          event.target.value = '';
        }
      };
      reader.readAsText(file, 'utf-8');
    }

    // ---------- CRENEAUX : UI DYNAMIQUE PAR JOUR (MODE MANUEL) ----------
    function renderDaysConfig() {
      const container = document.getElementById('daysConfigContainer');
      let html = '';

      DAYS.forEach((dayName, idx) => {
        html += `
          <div class="day-config">
            <div class="day-title">${dayName}</div>
            <div>
              <span>Nombre de créneaux : <span id="day_slot_count_${idx}">0</span></span>
              <button type="button" onclick="resetDaySlots(${idx})">
                Reset / réinitialiser
              </button>
              <button type="button" onclick="exportDaySlots(${idx})">
                Exporter les créneaux de ce jour
              </button>
              <button type="button" onclick="triggerImportDaySlots(${idx})">
                Importer des créneaux pour ce jour
              </button>
            </div>
            <div id="day_slots_container_${idx}" class="small"></div>
          </div>
        `;
      });

      container.innerHTML = html;
    }

    function createDaySlotRow(dayIndex, label = '', required = 0) {
      const container = document.getElementById(`day_slots_container_${dayIndex}`);
      if (!container) return;

      const row = document.createElement('div');
      row.className = 'day-slot-row';

      const idxSpan = document.createElement('span');
      idxSpan.className = 'day-slot-index';

      const labelInput = document.createElement('input');
      labelInput.type = 'text';
      labelInput.className = 'day-slot-label';
      labelInput.placeholder = '08:00-12:00';
      labelInput.value = label || '';

      const reqInput = document.createElement('input');
      reqInput.type = 'number';
      reqInput.className = 'day-slot-required';
      reqInput.min = '0';
      reqInput.value = (typeof required === 'number' ? required : 0);

      labelInput.addEventListener('input', () => {
        ensureTrailingEmptyDaySlot(dayIndex);
        updateDaySlotCount(dayIndex);
        updateStats();
        saveStateToLocalStorage();
      });
      reqInput.addEventListener('input', () => {
        updateDaySlotCount(dayIndex);
        updateStats();
        saveStateToLocalStorage();
      });

      row.appendChild(idxSpan);
      row.appendChild(labelInput);
      row.appendChild(reqInput);

      container.appendChild(row);
      renumberDaySlots(dayIndex);
      updateDaySlotCount(dayIndex);
    }

    function renumberDaySlots(dayIndex) {
      const container = document.getElementById(`day_slots_container_${dayIndex}`);
      if (!container) return;
      const rows = container.querySelectorAll('.day-slot-row');
      rows.forEach((row, idx) => {
        const span = row.querySelector('.day-slot-index');
        if (span) span.textContent = '#' + (idx + 1);
      });
    }

    function ensureTrailingEmptyDaySlot(dayIndex) {
      const container = document.getElementById(`day_slots_container_${dayIndex}`);
      if (!container) return;
      const rows = container.querySelectorAll('.day-slot-row');
      if (!rows.length) {
        createDaySlotRow(dayIndex, '', 0);
        return;
      }
      const last = rows[rows.length - 1];
      const labelInput = last.querySelector('.day-slot-label');
      const labelVal = labelInput ? labelInput.value.trim() : '';
      if (labelVal) {
        createDaySlotRow(dayIndex, '', 0);
      }
      renumberDaySlots(dayIndex);
    }

    function updateDaySlotCount(dayIndex) {
      const container = document.getElementById(`day_slots_container_${dayIndex}`);
      const counterSpan = document.getElementById(`day_slot_count_${dayIndex}`);
      if (!container || !counterSpan) return;
      const rows = container.querySelectorAll('.day-slot-row');
      let count = 0;
      rows.forEach(row => {
        const labelInput = row.querySelector('.day-slot-label');
        const reqInput = row.querySelector('.day-slot-required');
        const label = (labelInput && labelInput.value.trim()) || "";
        const required = parseInt(reqInput ? reqInput.value : "0", 10) || 0;
        if (label || required > 0) {
          count++;
        }
      });
      counterSpan.textContent = count;
    }

    function resetDaySlots(dayIndex) {
      const container = document.getElementById(`day_slots_container_${dayIndex}`);
      if (!container) return;
      container.innerHTML = '';
      createDaySlotRow(dayIndex, '', 0);
      ensureTrailingEmptyDaySlot(dayIndex);
      updateDaySlotCount(dayIndex);
      updateStats();
      saveStateToLocalStorage();
    }

    function initDaySlotsUI() {
      DAYS.forEach((_, idx) => {
        resetDaySlots(idx);
      });
    }

    // ---------- MODE CONFIG : MANUEL / BESOINS ----------
    function setSlotsConfigMode(mode) {
      slotsConfigMode = (mode === 'needs') ? 'needs' : 'manual';

      const manual = document.getElementById('manualSlotsWrapper');
      const needs = document.getElementById('needsWrapper');
      if (!manual || !needs) return;

      if (slotsConfigMode === 'manual') {
        manual.style.display = '';
        needs.style.display = 'none';
      } else {
        manual.style.display = 'none';
        needs.style.display = '';
      }
    }

    // ---------- BESOINS HORAIRES : UI ----------
    function getNeedsSegmentCount() {
      return (24 * 60) / needsResolutionMinutes;
    }

    function formatTimeFromMinutes(minutes) {
      const m = ((minutes % (24 * 60)) + (24 * 60)) % (24 * 60);
      const h = Math.floor(m / 60);
      const mm = m % 60;
      const hhStr = h < 10 ? '0' + h : '' + h;
      const mmStr = mm < 10 ? '0' + mm : '' + mm;
      return hhStr + ':' + mmStr;
    }

    function buildNeedsUI() {
      const container = document.getElementById('needsDaysContainer');
      if (!container) return;

      const baseStart = 5 * 60; // 5h00
      const segCount = getNeedsSegmentCount();

      let html = '';
      DAYS.forEach((dayName, dIdx) => {
        html += `
          <div class="needs-day-block">
            <div class="day-title">
              ${dayName}
              <button type="button" onclick="exportDayNeeds(${dIdx})" style="margin-left:8px;">Exporter ce jour</button>
              <button type="button" onclick="triggerImportNeedsDay(${dIdx})">Importer ce jour</button>
            </div>
            <table class="needs-time-table">
              <thead>
                <tr>
                  <th>Heure</th>
                  <th>Besoin (nb personnes)</th>
                </tr>
              </thead>
              <tbody>
        `;
        for (let s = 0; s < segCount; s++) {
          const startMin = baseStart + s * needsResolutionMinutes;
          const label = formatTimeFromMinutes(startMin);
          const val = (needsByDay[dIdx] && typeof needsByDay[dIdx][s] === 'number')
            ? needsByDay[dIdx][s]
            : 0;
          html += `
            <tr>
              <td class="needs-time-label">${label}</td>
              <td>
                <input type="number"
                       min="0"
                       value="${val}"
                       onchange="onNeedsInputChange(${dIdx}, ${s}, this.value)">
              </td>
            </tr>
          `;
        }
        html += `
              </tbody>
            </table>
          </div>
        `;
      });

      container.innerHTML = html;
    }

    function onNeedsInputChange(dayIndex, segmentIndex, value) {
      const n = parseInt(value, 10);
      const segCount = getNeedsSegmentCount();
      if (!needsByDay[dayIndex] || needsByDay[dayIndex].length !== segCount) {
        needsByDay[dayIndex] = new Array(segCount).fill(0);
      }
      needsByDay[dayIndex][segmentIndex] = isNaN(n) || n < 0 ? 0 : n;
      saveStateToLocalStorage();
    }

    function hasAnyNeedsData() {
      if (!Array.isArray(needsByDay)) return false;
      for (let d = 0; d < needsByDay.length; d++) {
        const arr = needsByDay[d];
        if (!Array.isArray(arr)) continue;
        if (arr.some(v => (v || 0) > 0)) return true;
      }
      return false;
    }

    function onNeedsResolutionChange() {
      const sel = document.getElementById('needsResolutionSelect');
      if (!sel) return;
      const newRes = parseInt(sel.value, 10);
      if (newRes === needsResolutionMinutes) return;

      if (hasAnyNeedsData()) {
        const ok = window.confirm(
          "Changer le pas horaire va réinitialiser les besoins déjà saisis. Continuer ?"
        );
        if (!ok) {
          sel.value = String(needsResolutionMinutes);
          return;
        }
      }

      needsResolutionMinutes = newRes;
      needsByDay = [];
      buildNeedsUI();
    }

    function initNeedsUI() {
      const sel = document.getElementById('needsResolutionSelect');
      if (sel) {
        const v = parseInt(sel.value, 10);
        needsResolutionMinutes = (v === 60 ? 60 : 30);
      } else {
        needsResolutionMinutes = 30;
      }
      needsByDay = [];
      buildNeedsUI();
    }

    // ---------- GÉNÉRATION DE CRÉNEAUX À PARTIR DES BESOINS ----------
    function generateSlotsFromNeeds() {
      const segCount = getNeedsSegmentCount();
      const baseStart = 5 * 60;

      for (let d = 0; d < DAYS.length; d++) {
        const needs = needsByDay[d] || [];
        const container = document.getElementById('day_slots_container_' + d);
        if (!container) continue;

        const daySlots = [];

        let s = 0;
        while (s < segCount) {
          const req = needs[s] || 0;
          if (req <= 0) {
            s++;
            continue;
          }

          const reqVal = req;
          const startSeg = s;
          let endSeg = s + 1;
          while (endSeg < segCount && (needs[endSeg] || 0) === reqVal) {
            endSeg++;
          }

          const startMin = baseStart + startSeg * needsResolutionMinutes;
          const endMin = baseStart + endSeg * needsResolutionMinutes;
          const label = formatTimeFromMinutes(startMin) + '-' + formatTimeFromMinutes(endMin);

          daySlots.push({ label, required: reqVal });

          s = endSeg;
        }

        container.innerHTML = '';
        daySlots.forEach(slot => {
          createDaySlotRow(d, slot.label, slot.required);
        });
        ensureTrailingEmptyDaySlot(d);
        updateDaySlotCount(d);
      }

      alert("Les créneaux ont été générés à partir des besoins horaires.\n" +
            "Tu peux les ajuster dans le mode « créneaux manuels », puis générer le planning (section 3).");

      updateStats();
      saveStateToLocalStorage();
    }

    // ---------- PARSING HORAIRES ----------
    function parseSlotDuration(label) {
      const trimmed = (label || '').trim();
      const regex = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/;
      const m = trimmed.match(regex);
      if (!m) {
        return {
          durationHours: 0,
          error: "format invalide (attendu HH:MM-HH:MM)",
          startMinutes: null,
          endMinutes: null
        };
      }

      const sh = parseInt(m[1], 10);
      const sm = parseInt(m[2], 10);
      const eh = parseInt(m[3], 10);
      const em = parseInt(m[4], 10);

      if (sh >= 24 || eh >= 24 || sm >= 60 || em >= 60) {
        return {
          durationHours: 0,
          error: "heure invalide",
          startMinutes: null,
          endMinutes: null
        };
      }

      const startMinutes = sh * 60 + sm;
      const endMinutes = eh * 60 + em;
      if (endMinutes <= startMinutes) {
        return {
          durationHours: 0,
          error: "heure de fin ≤ heure de début",
          startMinutes: null,
          endMinutes: null
        };
      }

      const durationHours = (endMinutes - startMinutes) / 60;
      return { durationHours, error: null, startMinutes, endMinutes };
    }

    function getSlotsByDay() {
      const slotsByDay = [];

      DAYS.forEach((dayName, dIdx) => {
        const container = document.getElementById(`day_slots_container_${dIdx}`);
        const rows = container ? container.querySelectorAll('.day-slot-row') : [];
        const daySlots = [];

        rows.forEach((row, idx) => {
          const labelInput = row.querySelector('.day-slot-label');
          const reqInput = row.querySelector('.day-slot-required');

          const label = (labelInput && labelInput.value.trim()) || "";
          const required = parseInt(reqInput ? reqInput.value : "0", 10) || 0;

          if (!label && required === 0) {
            return;
          }

          const parsed = parseSlotDuration(label);
          daySlots.push({
            dayIndex: dIdx,
            dayName,
            slotIndex: idx,
            label,
            required,
            durationHours: parsed.durationHours,
            parseError: parsed.error,
            startMinutes: parsed.startMinutes,
            endMinutes: parsed.endMinutes
          });
        });

        slotsByDay[dIdx] = daySlots;
      });

      return slotsByDay;
    }

    // ---------- EXPORT / IMPORT CRENEAUX JOUR ----------
    function exportDaySlots(dayIndex) {
      const container = document.getElementById(`day_slots_container_${dayIndex}`);
      if (!container) {
        showNotification("Aucun créneau défini pour ce jour.", "error");
        return;
      }
      const rows = container.querySelectorAll('.day-slot-row');
      const slots = [];
      rows.forEach(row => {
        const labelInput = row.querySelector('.day-slot-label');
        const reqInput = row.querySelector('.day-slot-required');
        const label = (labelInput && labelInput.value.trim()) || "";
        const required = parseInt(reqInput ? reqInput.value : "0", 10) || 0;
        if (!label && required === 0) return;
        slots.push({ label, required });
      });

      if (!slots.length) {
        showNotification("Aucun créneau défini pour ce jour.", "error");
        return;
      }

      const dayName = DAYS[dayIndex];
      const data = {
        type: "daySlots",
        dayIndex,
        dayName,
        slots
      };
      downloadJSON("creneaux_" + dayName.toLowerCase(), data, "Exporter les créneaux de " + dayName);
    }

    function triggerImportDaySlots(dayIndex) {
      pendingDayImportIndex = dayIndex;
      document.getElementById('importDayFile').click();
    }

    function handleImportDayFile(event) {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = function(e) {
        try {
          const data = JSON.parse(e.target.result);
          if (!data || !Array.isArray(data.slots)) {
            showNotification("Fichier créneaux jour invalide (champ 'slots' manquant ou incorrect).", "error");
            return;
          }
          const dayIndex = typeof pendingDayImportIndex === 'number' ? pendingDayImportIndex : 0;
          const slots = data.slots;

          const container = document.getElementById('day_slots_container_' + dayIndex);
          if (!container) return;

          container.innerHTML = '';
          slots.forEach(s => {
            createDaySlotRow(dayIndex, s.label || "", (typeof s.required === 'number' ? s.required : 0));
          });
          ensureTrailingEmptyDaySlot(dayIndex);
          updateDaySlotCount(dayIndex);
          updateStats();
          saveStateToLocalStorage();
          showNotification(`Créneaux pour ${DAYS[dayIndex]} importés.`);
        } catch (err) {
          console.error(err);
          showNotification("Erreur lors de la lecture du fichier créneaux jour.", "error");
        } finally {
          pendingDayImportIndex = null;
          event.target.value = '';
        }
      };
      reader.readAsText(file, 'utf-8');
    }

    // ---------- EXPORT / IMPORT SEMAINE COMPLÈTE (CRENEAUX) ----------
    function exportWeekSlots() {
      const slotsByDay = getSlotsByDay();
      const any = slotsByDay.some(daySlots => daySlots && daySlots.length > 0);
      if (!any) {
        showNotification("Aucun créneau défini sur la semaine.", "error");
        return;
      }
      const weekData = {
        type: "weekSlots",
        days: DAYS.map((dayName, dIdx) => {
          const daySlots = slotsByDay[dIdx] || [];
          return {
            dayIndex: dIdx,
            dayName,
            slots: daySlots.map(s => ({
              label: s.label,
              required: s.required
            }))
          };
        })
      };
      downloadJSON("creneaux_semaine", weekData, "Exporter l'ensemble des créneaux de la semaine");
    }

    function handleImportWeekFile(event) {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = function(e) {
        try {
          const data = JSON.parse(e.target.result);
          if (!data || !Array.isArray(data.days)) {
            showNotification("Fichier créneaux semaine invalide (champ 'days' manquant ou incorrect).", "error");
            return;
          }

          data.days.forEach(dayData => {
            if (!dayData || !Array.isArray(dayData.slots)) return;
            const dIdx = typeof dayData.dayIndex === 'number'
              ? dayData.dayIndex
              : DAYS.indexOf(dayData.dayName);
            if (dIdx < 0 || dIdx >= DAYS.length) return;

            const container = document.getElementById('day_slots_container_' + dIdx);
            if (!container) return;

            container.innerHTML = '';
            dayData.slots.forEach(s => {
              createDaySlotRow(dIdx, s.label || "", (typeof s.required === 'number' ? s.required : 0));
            });
            ensureTrailingEmptyDaySlot(dIdx);
            updateDaySlotCount(dIdx);
          });

          updateStats();
          saveStateToLocalStorage();
          showNotification("Créneaux de la semaine importés.");
        } catch (err) {
          console.error(err);
          showNotification("Erreur lors de la lecture du fichier créneaux semaine.", "error");
        } finally {
          event.target.value = '';
        }
      };
      reader.readAsText(file, 'utf-8');
    }

    // ---------- EXPORT / IMPORT BESOINS HORAIRES ----------
    function exportDayNeeds(dayIndex) {
      const segCount = getNeedsSegmentCount();
      const baseStart = 5 * 60;
      const arr = needsByDay[dayIndex] || [];
      const needsArr = [];
      for (let s = 0; s < segCount; s++) {
        needsArr.push(arr[s] || 0);
      }
      const data = {
        type: "dayNeeds",
        dayIndex,
        dayName: DAYS[dayIndex],
        resolutionMinutes: needsResolutionMinutes,
        baseStartMinutes: baseStart,
        needs: needsArr
      };
      downloadJSON("besoins_" + DAYS[dayIndex].toLowerCase(), data,
        "Exporter les besoins horaires de " + DAYS[dayIndex]);
    }

    function triggerImportNeedsDay(dayIndex) {
      pendingNeedsDayImportIndex = dayIndex;
      document.getElementById('importNeedsDayFile').click();
    }

    function handleImportNeedsDayFile(event) {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = function(e) {
        try {
          const data = JSON.parse(e.target.result);
          if (!data || !Array.isArray(data.needs)) {
            showNotification("Fichier besoins jour invalide (champ 'needs' manquant ou incorrect).", "error");
            return;
          }
          const res = parseInt(data.resolutionMinutes, 10);
          if (res !== needsResolutionMinutes) {
            showNotification("Résolution différente de la configuration actuelle.\n" +
                  "Change d'abord le pas temporel, puis réessaie l'import.", "error");
            return;
          }
          const segCount = getNeedsSegmentCount();
          const dayIndex = typeof pendingNeedsDayImportIndex === 'number'
            ? pendingNeedsDayImportIndex
            : 0;

          const arr = new Array(segCount).fill(0);
          for (let s = 0; s < segCount; s++) {
            arr[s] = parseInt(data.needs[s] || 0, 10) || 0;
          }
          needsByDay[dayIndex] = arr;

          buildNeedsUI();
          saveStateToLocalStorage();
          showNotification(`Besoins horaires pour ${DAYS[dayIndex]} importés.`);
        } catch (err) {
          console.error(err);
          showNotification("Erreur lors de la lecture du fichier besoins jour.", "error");
        } finally {
          pendingNeedsDayImportIndex = null;
          event.target.value = '';
        }
      };
      reader.readAsText(file, 'utf-8');
    }

    function exportWeekNeeds() {
      const segCount = getNeedsSegmentCount();
      const baseStart = 5 * 60;

      const daysData = DAYS.map((dayName, dIdx) => {
        const arr = needsByDay[dIdx] || [];
        const needsArr = [];
        for (let s = 0; s < segCount; s++) {
          needsArr.push(arr[s] || 0);
        }
        return {
          dayIndex: dIdx,
          dayName,
          needs: needsArr
        };
      });

      const data = {
        type: "weekNeeds",
        resolutionMinutes: needsResolutionMinutes,
        baseStartMinutes: baseStart,
        days: daysData
      };

      downloadJSON("besoins_semaine", data, "Exporter les besoins horaires de la semaine");
    }

    function handleImportWeekNeedsFile(event) {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = function(e) {
        try {
          const data = JSON.parse(e.target.result);
          if (!data || !Array.isArray(data.days)) {
            showNotification("Fichier besoins semaine invalide (champ 'days' manquant ou incorrect).", "error");
            return;
          }
          const res = parseInt(data.resolutionMinutes, 10);
          if (res !== 30 && res !== 60) {
            showNotification("Résolution de temps non supportée (seulement 30 ou 60 minutes).", "error");
            return;
          }

          needsResolutionMinutes = res;
          const sel = document.getElementById('needsResolutionSelect');
          if (sel) {
            sel.value = String(res);
          }

          const segCount = (24 * 60) / needsResolutionMinutes;
          needsByDay = [];

          data.days.forEach(dayData => {
            if (!dayData || !Array.isArray(dayData.needs)) return;
            const dIdx = typeof dayData.dayIndex === 'number'
              ? dayData.dayIndex
              : DAYS.indexOf(dayData.dayName);
            if (dIdx < 0 || dIdx >= DAYS.length) return;

            const arr = new Array(segCount).fill(0);
            for (let s = 0; s < segCount; s++) {
              arr[s] = parseInt(dayData.needs[s] || 0, 10) || 0;
            }
            needsByDay[dIdx] = arr;
          });

          buildNeedsUI();
          saveStateToLocalStorage();
          showNotification("Besoins de la semaine importés.");
        } catch (err) {
          console.error(err);
          showNotification("Erreur lors de la lecture du fichier besoins semaine.", "error");
        } finally {
          event.target.value = '';
        }
      };
      reader.readAsText(file, 'utf-8');
    }

    // ---------- SNAPSHOT / RESTORE AFFECTATIONS ----------
    function snapshotAssignments() {
      const snapshot = {};
      const containers = document.querySelectorAll('.assignments-container');
      containers.forEach(container => {
        const day = container.dataset.dayIndex;
        const slot = container.dataset.slotIndex;
        const key = day + '_' + slot;
        const names = Array.from(container.querySelectorAll('.assignment-input'))
          .map(i => i.value.trim())
          .filter(v => v);
        if (names.length) {
          snapshot[key] = names;
        }
      });
      return snapshot;
    }

    // anti-doublon dans un créneau
    function checkDuplicateInSlot(container, currentInput) {
      const val = currentInput.value.trim();
      if (!val) return;
      const inputs = Array.from(container.querySelectorAll('.assignment-input'));
      const same = inputs.filter(i => i.value.trim() === val);
      if (same.length > 1) {
        currentInput.value = '';
        showNotification('Ce nom est déjà utilisé dans ce créneau.', "error");
      }
    }

    // vérifie chevauchement sur le même jour
    function checkOverlapInDay(container, currentInput) {
      const name = currentInput.value.trim();
      if (!name) return;

      const dayIndex = parseInt(container.dataset.dayIndex, 10);
      const slotIndex = parseInt(container.dataset.slotIndex, 10);
      if (isNaN(dayIndex) || isNaN(slotIndex)) return;

      const slotsByDay = currentSlotsByDay || [];
      const daySlots = slotsByDay[dayIndex] || [];

      const currentSlot = daySlots.find(s => s.slotIndex === slotIndex);
      if (!currentSlot ||
          currentSlot.parseError ||
          currentSlot.startMinutes == null ||
          currentSlot.endMinutes == null) {
        return;
      }

      for (const s of daySlots) {
        if (!s ||
            s.slotIndex === slotIndex ||
            s.parseError ||
            s.startMinutes == null ||
            s.endMinutes == null) {
          continue;
        }

        const overlap =
          currentSlot.startMinutes < s.endMinutes &&
          currentSlot.endMinutes > s.startMinutes;

        if (!overlap) continue;

        const otherContainer = document.querySelector(
          `.assignments-container[data-day-index="${s.dayIndex}"][data-slot-index="${s.slotIndex}"]`
        );
        if (!otherContainer) continue;

        const otherNames = Array.from(otherContainer.querySelectorAll('.assignment-input'))
          .map(i => i.value.trim())
          .filter(v => v);

        if (otherNames.includes(name)) {
          currentInput.value = '';
          showNotification(
            `${name} est déjà affecté sur un créneau qui se chevauche (${s.dayName} ${s.label}).`, "error"
          );
          return;
        }
      }
    }

    function addAssignmentInput(container, value = '') {
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'assignment-input';
      input.placeholder = 'Nom';
      input.value = value;
      input.setAttribute('list', 'staffDatalist');

      input.addEventListener('input', function () {
        checkDuplicateInSlot(container, this);
        checkOverlapInDay(container, this);

        const inputs = Array.from(container.querySelectorAll('.assignment-input'));
        const last = inputs[inputs.length - 1];
        if (last && last.value.trim() !== '') {
          addAssignmentInput(container);
        }
        updateStats();
        saveStateToLocalStorage();
      });

      container.appendChild(input);
    }

    function initAssignmentsInputs(assignmentsMap = {}) {
      const containers = document.querySelectorAll('.assignments-container');
      containers.forEach(container => {
        container.innerHTML = '';
        const day = container.dataset.dayIndex;
        const slot = container.dataset.slotIndex;
        const key = day + '_' + slot;
        const names = assignmentsMap[key] || [];

        if (names.length) {
          names.forEach(name => addAssignmentInput(container, name));
        }

        const inputs = container.querySelectorAll('.assignment-input');
        if (!inputs.length || inputs[inputs.length - 1].value.trim() !== '') {
          addAssignmentInput(container);
        }
      });
    }

    // ---------- VUE HORAIRE DÉTAILLÉE (5h → 5h, tous employés) ----------
    function recomputeTimelineView() {
      const container = document.getElementById('scheduleTimelineContainer');
      if (!container) return;

      const slotsByDay = currentSlotsByDay || [];
      const staff = currentStaff || [];

      if (!slotsByDay.length || !staff.length) {
        container.innerHTML = "<p>Aucune donnée pour la vue horaire détaillée (génère d'abord le planning).</p>";
        return;
      }

      const baseStartMinutes = 5 * 60;
      const segments = 48; // 30min
      const counts = [];

      for (let d = 0; d < DAYS.length; d++) {
        counts[d] = new Array(segments).fill(0);
      }

      for (let d = 0; d < slotsByDay.length; d++) {
        const daySlots = slotsByDay[d] || [];
        daySlots.forEach(slot => {
          if (!slot || slot.parseError || slot.startMinutes == null || slot.endMinutes == null) return;

          const assignContainer = document.querySelector(
            `.assignments-container[data-day-index="${slot.dayIndex}"][data-slot-index="${slot.slotIndex}"]`
          );
          if (!assignContainer) return;

          const names = Array.from(assignContainer.querySelectorAll('.assignment-input'))
            .map(i => i.value.trim())
            .filter(v => v);

          const validNames = names.filter(name => staff.findIndex(p => p.name === name) !== -1);
          if (!validNames.length) return;

          const nbAssigned = validNames.length;

          for (let seg = 0; seg < segments; seg++) {
            const segStart = baseStartMinutes + seg * 30;
            const segEnd = segStart + 30;
            if (slot.startMinutes < segEnd && slot.endMinutes > segStart) {
              counts[d][seg] += nbAssigned;
            }
          }
        });
      }

      let html = '<table class="timeline-table"><thead><tr>' +
                 '<th class="timeline-time-col">Heure</th>';
      DAYS.forEach(dayName => {
        html += `<th>${dayName}</th>`;
      });
      html += '</tr></thead><tbody>';

      for (let seg = 0; seg < 48; seg++) {
        const minutes = baseStartMinutes + seg * 30;
        const h = Math.floor((minutes % (24 * 60)) / 60);
        const m = minutes % 60;
        const label =
          (h < 10 ? '0' + h : '' + h) + ':' + (m < 10 ? '0' + m : '' + m);

        const isHourRow = (m === 0);
        const rowClass = isHourRow ? 'timeline-hour-row' : 'timeline-half-row';

        html += `<tr class="${rowClass}"><td class="timeline-time-col">${label}</td>`;

        for (let d = 0; d < DAYS.length; d++) {
          const c = counts[d][seg];
          if (c > 0) {
            if (isHourRow) {
              html += `<td class="timeline-slot"><span class="timeline-hour-label">${label}</span><span class="timeline-count">${c}</span></td>`;
            } else {
              html += `<td class="timeline-slot"><span class="timeline-count">${c}</span></td>`;
            }
          } else {
            if (isHourRow) {
              html += `<td><span class="timeline-hour-label">${label}</span></td>`;
            } else {
              html += '<td></td>';
            }
          }
        }

        html += '</tr>';
      }

      html += '</tbody></table>';
      container.innerHTML = html;
    }

    // ---------- VUE PERSONNE (5h → 5h, une personne) ----------
    function recomputePersonTimelineView() {
      const container = document.getElementById('personTimelineContainer');
      if (!container) return;

      const select = document.getElementById('personViewSelect');
      const personName = select ? select.value.trim() : '';
      const slotsByDay = currentSlotsByDay || [];
      const staff = currentStaff || [];

      if (!slotsByDay.length || !staff.length) {
        container.innerHTML = "<p>Aucune donnée pour la vue par personne (génère d'abord le planning).</p>";
        return;
      }

      if (!personName) {
        container.innerHTML = "<p>Sélectionne une personne pour afficher sa grille horaire.</p>";
        return;
      }

      if (staff.findIndex(p => p.name === personName) === -1) {
        container.innerHTML = "<p>La personne sélectionnée n'est plus présente dans la liste du staff.</p>";
        return;
      }

      const baseStartMinutes = 5 * 60;
      const segments = 48;
      const presence = [];

      for (let d = 0; d < DAYS.length; d++) {
        presence[d] = new Array(segments).fill(false);
      }

      for (let d = 0; d < slotsByDay.length; d++) {
        const daySlots = slotsByDay[d] || [];
        daySlots.forEach(slot => {
          if (!slot || slot.parseError || slot.startMinutes == null || slot.endMinutes == null) return;

          const assignContainer = document.querySelector(
            `.assignments-container[data-day-index="${slot.dayIndex}"][data-slot-index="${slot.slotIndex}"]`
          );
          if (!assignContainer) return;

          const names = Array.from(assignContainer.querySelectorAll('.assignment-input'))
            .map(i => i.value.trim())
            .filter(v => v);

          if (!names.includes(personName)) return;
          if (staff.findIndex(p => p.name === personName) === -1) return;

          for (let seg = 0; seg < segments; seg++) {
            const segStart = baseStartMinutes + seg * 30;
            const segEnd = segStart + 30;
            if (slot.startMinutes < segEnd && slot.endMinutes > segStart) {
              presence[d][seg] = true;
            }
          }
        });
      }

      let html = '<table class="timeline-table"><thead><tr>' +
                 '<th class="timeline-time-col">Heure</th>';
      DAYS.forEach(dayName => {
        html += `<th>${dayName}</th>`;
      });
      html += '</tr></thead><tbody>';

      for (let seg = 0; seg < 48; seg++) {
        const minutes = baseStartMinutes + seg * 30;
        const h = Math.floor((minutes % (24 * 60)) / 60);
        const m = minutes % 60;
        const label =
          (h < 10 ? '0' + h : '' + h) + ':' + (m < 10 ? '0' + m : '' + m);

        const isHourRow = (m === 0);
        const rowClass = isHourRow ? 'timeline-hour-row' : 'timeline-half-row';

        html += `<tr class="${rowClass}"><td class="timeline-time-col">${label}</td>`;

        for (let d = 0; d < DAYS.length; d++) {
          if (presence[d][seg]) {
            if (isHourRow) {
              html += `<td class="timeline-slot"><span class="timeline-hour-label">${label}</span>${personName}</td>`;
            } else {
              html += `<td class="timeline-slot">${personName}</td>`;
            }
          } else {
            if (isHourRow) {
              html += `<td><span class="timeline-hour-label">${label}</span></td>`;
            } else {
              html += '<td></td>';
            }
          }
        }

        html += '</tr>';
      }

      html += '</tbody></table>';
      container.innerHTML = html;
    }

    function onPersonViewChange() {
      if (currentScheduleView === 'person') {
        recomputePersonTimelineView();
      }
    }

    // ---------- SWITCH VUE PLANNING ----------
    function setScheduleView(view) {
      if (view === 'timeline') {
        currentScheduleView = 'timeline';
      } else if (view === 'person') {
        currentScheduleView = 'person';
      } else {
        currentScheduleView = 'slots';
      }

      const slotsTitle = document.getElementById('slotsTitle');
      const timelineTitle = document.getElementById('timelineTitle');
      const personTimelineTitle = document.getElementById('personTimelineTitle');
      const scheduleContainer = document.getElementById('scheduleContainer');
      const timelineContainer = document.getElementById('scheduleTimelineContainer');
      const personTimelineContainer = document.getElementById('personTimelineContainer');

      if (!slotsTitle || !timelineTitle || !scheduleContainer || !timelineContainer || !personTimelineTitle || !personTimelineContainer) return;

      if (currentScheduleView === 'slots') {
        slotsTitle.style.display = '';
        scheduleContainer.style.display = '';
        timelineTitle.style.display = 'none';
        timelineContainer.style.display = 'none';
        personTimelineTitle.style.display = 'none';
        personTimelineContainer.style.display = 'none';
      } else if (currentScheduleView === 'timeline') {
        slotsTitle.style.display = 'none';
        scheduleContainer.style.display = 'none';
        timelineTitle.style.display = '';
        timelineContainer.style.display = '';
        personTimelineTitle.style.display = 'none';
        personTimelineContainer.style.display = 'none';
        recomputeTimelineView();
      } else {
        slotsTitle.style.display = 'none';
        scheduleContainer.style.display = 'none';
        timelineTitle.style.display = 'none';
        timelineContainer.style.display = 'none';
        personTimelineTitle.style.display = '';
        personTimelineContainer.style.display = '';
        recomputePersonTimelineView();
      }
    }

    // ---------- CALENDRIER (vue par créneaux) ----------
    function generateCalendar() {
      const previousAssignments = snapshotAssignments();

      const slotsByDay = getSlotsByDay();
      const staff = getStaff();
      const container = document.getElementById('scheduleContainer');

      currentSlotsByDay = slotsByDay;
      currentStaff = staff;

      const hasAnySlot = slotsByDay.some(daySlots => daySlots && daySlots.length > 0);

      if (!hasAnySlot) {
        container.innerHTML = "<p>Aucun créneau défini sur la semaine.</p>";
        recomputeTimelineView();
        recomputePersonTimelineView();
        updateStats();
        return;
      }

      if (!staff.length) {
        container.innerHTML = "<p>Définis d'abord au moins une personne dans la section Staff.</p>";
        recomputeTimelineView();
        recomputePersonTimelineView();
        updateStats();
        return;
      }

      let maxSlots = 0;
      slotsByDay.forEach(daySlots => {
        if (daySlots && daySlots.length > maxSlots) maxSlots = daySlots.length;
      });

      let html = '<table><thead><tr><th>Créneau</th>';
      DAYS.forEach(dayName => {
        html += `<th>${dayName}</th>`;
      });
      html += '</tr></thead><tbody>';

      for (let row = 0; row < maxSlots; row++) {
        html += `<tr><td>Créneau ${row + 1}</td>`;
        for (let d = 0; d < DAYS.length; d++) {
          const daySlots = slotsByDay[d] || [];
          const slot = daySlots[row];
          if (!slot) {
            html += '<td class="calendar-cell"></td>';
            continue;
          }

          const parseError = slot.parseError;
          const durationText = parseError
            ? `Durée: n/a`
            : `Durée: ${slot.durationHours.toFixed(2)} h`;

          html += `<td class="calendar-cell" data-day-index="${slot.dayIndex}" data-slot-index="${slot.slotIndex}">
                     <div class="calendar-cell-inner">
                       <div class="slot-label">${slot.label || "(non défini)"}</div>
                       <div class="slot-meta">
                         Besoin: ${slot.required}<br>${durationText}
                       </div>`;

          if (parseError) {
            html += `<div class="warning small">Format horaire invalide</div>`;
          } else {
            html += `<div class="assignments-container"
                            data-day-index="${slot.dayIndex}"
                            data-slot-index="${slot.slotIndex}"></div>`;
          }

          html += `  </div>
                   </td>`;
        }
        html += '</tr>';
      }

      html += '</tbody></table>';
      container.innerHTML = html;

      initAssignmentsInputs(previousAssignments);
      updateStats();
      recomputeTimelineView();
      recomputePersonTimelineView();
      saveStateToLocalStorage();
    }

    // ---------- AUTO-RÉPARTITION ----------
    function autoFillAssignments() {
      const staff = currentStaff || [];
      const slotsByDay = currentSlotsByDay || [];

      if (!staff.length) {
        showNotification("Définis d'abord le staff (section 1).", "error");
        return;
      }
      if (!slotsByDay.length) {
        showNotification("Génère d'abord le planning hebdomadaire.", "error");
        return;
      }

      const containers = document.querySelectorAll('.assignments-container');
      if (!containers.length) {
        showNotification("Génère d'abord le planning hebdomadaire.", "error");
        return;
      }

      containers.forEach(container => {
        container.innerHTML = '';
        addAssignmentInput(container);
      });

      let staffIndex = 0;

      for (let d = 0; d < slotsByDay.length; d++) {
        const daySlots = slotsByDay[d] || [];
        for (let s = 0; s < daySlots.length; s++) {
          const slot = daySlots[s];
          if (!slot) continue;
          if (slot.parseError) continue;

          const required = slot.required || 0;
          if (required <= 0) continue;

          const container = document.querySelector(
            `.assignments-container[data-day-index="${slot.dayIndex}"][data-slot-index="${slot.slotIndex}"]`
          );
          if (!container) continue;

          let assignedCount = 0;
          const seen = new Set();

          while (assignedCount < required && seen.size < staff.length) {
            const idx = staffIndex % staff.length;
            const name = staff[idx].name;

            let inputs = Array.from(container.querySelectorAll('.assignment-input'));
            let target = inputs.find(i => i.value.trim() === '');
            if (!target) {
              addAssignmentInput(container);
              inputs = Array.from(container.querySelectorAll('.assignment-input'));
              target = inputs[inputs.length - 1];
            }

            target.value = name;
            assignedCount++;
            staffIndex++;
            seen.add(idx);
          }

          const inputsAfter = Array.from(container.querySelectorAll('.assignment-input'));
          const last = inputsAfter[inputsAfter.length - 1];
          if (last && last.value.trim() !== '') {
            addAssignmentInput(container);
          }
        }
      }

      updateStats();
      recomputeTimelineView();
      recomputePersonTimelineView();
      saveStateToLocalStorage();
    }

    // ---------- RESET AFFECTATIONS ----------
    function resetAssignments() {
      const containers = document.querySelectorAll('.assignments-container');
      if (!containers.length) return;
      containers.forEach(container => {
        container.innerHTML = '';
        addAssignmentInput(container);
      });
      updateStats();
      recomputeTimelineView();
      recomputePersonTimelineView();
      saveStateToLocalStorage();
    }

    // ---------- STATS & WARNINGS ----------
    function updateStats() {
      const hoursContainer = document.getElementById('hoursSummaryContainer');
      const warningsContainer = document.getElementById('slotWarningsContainer');

      const staff = currentStaff || [];
      const slotsByDay = currentSlotsByDay || [];

      if (!hoursContainer || !warningsContainer) return;

      if (!staff.length || !slotsByDay.length) {
        hoursContainer.innerHTML = "<p>Aucune donnée pour calculer les heures.</p>";
        warningsContainer.innerHTML = "<p>Aucune donnée.</p>";
        return;
      }

      const personHours = new Array(staff.length).fill(0);
      const parseWarnings = [];
      const staffingWarnings = [];
      const nameWarnings = [];

      document.querySelectorAll('#scheduleContainer td.calendar-cell').forEach(td => {
        td.classList.remove('understaffed');
      });

      for (let d = 0; d < slotsByDay.length; d++) {
        const daySlots = slotsByDay[d] || [];
        daySlots.forEach(slot => {
          if (!slot) return;

          if (slot.parseError) {
            const label = slot.label || "(non défini)";
            parseWarnings.push(`Créneau ${slot.dayName} "${label}" : ${slot.parseError}`);
            return;
          }

          const container = document.querySelector(
            `.assignments-container[data-day-index="${slot.dayIndex}"][data-slot-index="${slot.slotIndex}"]`
          );
          if (!container) return;

          const rawNames = Array.from(container.querySelectorAll('.assignment-input'))
            .map(i => i.value.trim())
            .filter(v => v);

          const validIdxs = [];

          rawNames.forEach(name => {
            const idx = staff.findIndex(p => p.name === name);
            if (idx === -1) {
              nameWarnings.push(
                `Nom "${name}" non présent dans la liste du staff (créneau ${slot.dayName} "${slot.label}").`
              );
            } else {
              validIdxs.push(idx);
            }
          });

          validIdxs.forEach(idx => {
            personHours[idx] += slot.durationHours;
          });

          const assignedCount = validIdxs.length;

          if (assignedCount < slot.required) {
            staffingWarnings.push(
              `Créneau ${slot.dayName} "${slot.label}" : besoin ${slot.required}, assignés ${assignedCount}`
            );
            const cell = container.closest('td.calendar-cell');
            if (cell) cell.classList.add('understaffed');
          }
        });
      }

      let hoursHtml = '<table><thead><tr><th>Personne</th><th>Heures totales</th></tr></thead><tbody>';
      staff.forEach((p, idx) => {
        hoursHtml += `<tr><td>${p.name}</td><td>${personHours[idx].toFixed(2)}</td></tr>`;
      });
      hoursHtml += '</tbody></table>';
      hoursContainer.innerHTML = hoursHtml;

      let warnHtml = '';
      if (parseWarnings.length) {
        warnHtml += '<p class="warning"><strong>Problèmes de format horaire :</strong></p><ul class="warning">';
        parseWarnings.forEach(msg => { warnHtml += `<li>${msg}</li>`; });
        warnHtml += '</ul>';
      }
      if (nameWarnings.length) {
        warnHtml += '<p class="warning"><strong>Noms non reconnus :</strong></p><ul class="warning">';
        nameWarnings.forEach(msg => { warnHtml += `<li>${msg}</li>`; });
        warnHtml += '</ul>';
      }
      if (staffingWarnings.length) {
        warnHtml += '<p class="warning"><strong>Créneaux sous-staffés :</strong></p><ul class="warning">';
        staffingWarnings.forEach(msg => { warnHtml += `<li>${msg}</li>`; });
        warnHtml += '</ul>';
      }
      if (!warnHtml) {
        warnHtml = '<p class="ok">Tous les créneaux valides sont correctement pourvus, les formats horaires et les noms sont corrects.</p>';
      }
      warningsContainer.innerHTML = warnHtml;

      if (currentScheduleView === 'timeline') {
        recomputeTimelineView();
      } else if (currentScheduleView === 'person') {
        recomputePersonTimelineView();
      }
    }

    // ---------- LOCALSTORAGE PERSISTENCE ----------
    function saveStateToLocalStorage() {
      const staff = collectStaffFromDOM();
      const slotsByDay = getSlotsByDay();
      const assignments = snapshotAssignments();
      const needs = {
        resolution: needsResolutionMinutes,
        data: needsByDay,
      };

      const state = {
        staff,
        slotsByDay,
        assignments,
        needs,
        slotsConfigMode,
        currentScheduleView,
        selectedPerson: document.getElementById('personViewSelect').value,
      };

      localStorage.setItem('planningState', JSON.stringify(state));
    }

    function loadStateFromLocalStorage() {
      const savedState = localStorage.getItem('planningState');
      if (!savedState) return;

      try {
        const state = JSON.parse(savedState);

        // Restore staff
        const container = document.getElementById('staffTableContainer');
        if (container) {
          container.innerHTML = '';
          state.staff.forEach(s => createStaffInput(s.name));
          ensureTrailingEmptyStaffInput();
          updateStaffModelAndUI();
        }

        // Restore slots
        state.slotsByDay.forEach((daySlots, dayIndex) => {
          const dayContainer = document.getElementById(`day_slots_container_${dayIndex}`);
          if (dayContainer) {
            dayContainer.innerHTML = '';
            daySlots.forEach(slot => createDaySlotRow(dayIndex, slot.label, slot.required));
            ensureTrailingEmptyDaySlot(dayIndex);
            updateDaySlotCount(dayIndex);
          }
        });

        // Restore needs
        if (state.needs) {
          const sel = document.getElementById('needsResolutionSelect');
          if (sel) {
            sel.value = String(state.needs.resolution || 30);
          }
          needsResolutionMinutes = state.needs.resolution || 30;
          needsByDay = state.needs.data || [];
          buildNeedsUI();
        }
        
        // Restore config mode
        setSlotsConfigMode(state.slotsConfigMode || 'manual');

        // Generate calendar to create assignment containers
        generateCalendar();

        // Restore assignments
        if (state.assignments) {
          initAssignmentsInputs(state.assignments);
        }

        // Restore view and stats
        updateStats();
        setScheduleView(state.currentScheduleView || 'slots');
        
        const personSelect = document.getElementById('personViewSelect');
        if (personSelect && state.selectedPerson) {
          personSelect.value = state.selectedPerson;
          onPersonViewChange();
        }

      } catch (e) {
        console.error("Error loading state from localStorage", e);
        // Clear corrupted state
        localStorage.removeItem('planningState');
      }
    }

    // ---------- INIT ----------
    window.addEventListener('load', () => {
      renderDaysConfig();
      initStaffUI();
      initDaySlotsUI();
      initNeedsUI();
      loadStateFromLocalStorage();
    });

    function clearAllData() {
      if (confirm("Êtes-vous sûr de vouloir effacer toutes les données ? Cette action est irréversible.")) {
        localStorage.removeItem('planningState');
        location.reload();
      }
    }
