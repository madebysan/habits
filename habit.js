// ============================================
// HABIT TRACKER - Main Application Logic
// ============================================
// Data is stored in chrome.storage.local with these keys:
// - 'habits': Array of habit objects
// - 'completions': Object mapping habitId -> { date: state }
// ============================================

// Storage keys
const STORAGE_KEYS = {
  habits: 'habits',
  completions: 'completions'
};

// App state
let habits = [];
let completions = {};
const DAYS_TO_SHOW = 14;
let viewEndDate = new Date();
let draggedHabit = null;

// ============================================
// INITIALIZATION
// ============================================

document.addEventListener('DOMContentLoaded', async () => {
  await loadData();
  renderDayHeaders();
  renderHabits();
  setupEventListeners();
  setupNewTabToggle();
});

// ============================================
// DATA PERSISTENCE
// ============================================

async function loadData() {
  try {
    const result = await chrome.storage.local.get([STORAGE_KEYS.habits, STORAGE_KEYS.completions]);
    habits = result[STORAGE_KEYS.habits] || [];
    completions = result[STORAGE_KEYS.completions] || {};

    // Migrate old array-based completions to new object format
    let needsMigration = false;
    for (const habitId of Object.keys(completions)) {
      if (Array.isArray(completions[habitId])) {
        const oldDates = completions[habitId];
        completions[habitId] = {};
        for (const date of oldDates) {
          completions[habitId][date] = 'done';
        }
        needsMigration = true;
      }
    }
    if (needsMigration) {
      await saveCompletions();
    }

    console.log('Data loaded:', { habits: habits.length });
  } catch (error) {
    console.error('Failed to load data:', error);
    showToast('Failed to load data');
  }
}

async function saveHabits() {
  try {
    await chrome.storage.local.set({ [STORAGE_KEYS.habits]: habits });
  } catch (error) {
    console.error('Failed to save habits:', error);
    showToast('Failed to save habits');
  }
}

async function saveCompletions() {
  try {
    await chrome.storage.local.set({ [STORAGE_KEYS.completions]: completions });
  } catch (error) {
    console.error('Failed to save completions:', error);
    showToast('Failed to save completions');
  }
}

// ============================================
// HABIT MANAGEMENT
// ============================================

function addHabit(name) {
  const maxOrder = habits.reduce((max, h) => Math.max(max, h.order || 0), 0);

  const habit = {
    id: generateId(),
    name: name.trim(),
    order: maxOrder + 1,
    createdAt: new Date().toISOString()
  };

  habits.push(habit);
  completions[habit.id] = {};

  saveHabits();
  saveCompletions();
  renderHabits();

  showToast('Habit added');
}

function deleteHabit(habitId) {
  const habit = habits.find(h => h.id === habitId);
  if (!habit) return;

  showConfirm(
    `Delete "${habit.name}"?`,
    'This will permanently delete this habit and all its history.',
    () => {
      habits = habits.filter(h => h.id !== habitId);
      delete completions[habitId];

      saveHabits();
      saveCompletions();
      renderHabits();

      showToast('Habit deleted');
    }
  );
}

function renameHabit(habitId, newName) {
  const habit = habits.find(h => h.id === habitId);
  if (!habit || !newName.trim()) return;

  habit.name = newName.trim();
  saveHabits();
  renderHabits();
}

// Toggle habit state: empty → done → skipped → empty
function toggleCompletion(habitId, dateStr) {
  if (!completions[habitId]) {
    completions[habitId] = {};
  }

  const currentState = completions[habitId][dateStr];

  if (!currentState) {
    completions[habitId][dateStr] = 'done';
  } else if (currentState === 'done') {
    completions[habitId][dateStr] = 'skipped';
  } else {
    delete completions[habitId][dateStr];
  }

  saveCompletions();
  renderHabits();
}

function getHabitState(habitId, dateStr) {
  return completions[habitId]?.[dateStr] || null;
}

function reorderHabits(fromIndex, toIndex) {
  const [moved] = habits.splice(fromIndex, 1);
  habits.splice(toIndex, 0, moved);

  habits.forEach((habit, index) => {
    habit.order = index;
  });

  saveHabits();
  renderHabits();
}

// Calculate streak (only counts 'done' states)
function calculateStreak(habitId) {
  const habitData = completions[habitId] || {};

  const doneDates = Object.entries(habitData)
    .filter(([_, state]) => state === 'done')
    .map(([date, _]) => date);

  if (doneDates.length === 0) return { current: 0, longest: 0 };

  const sortedDates = [...doneDates].sort((a, b) => new Date(b) - new Date(a));

  let current = 0;
  const today = formatDate(new Date());
  const yesterday = formatDate(new Date(Date.now() - 86400000));

  if (sortedDates[0] === today || sortedDates[0] === yesterday) {
    current = 1;
    for (let i = 1; i < sortedDates.length; i++) {
      const prevDate = new Date(sortedDates[i - 1]);
      const currDate = new Date(sortedDates[i]);
      const diffDays = Math.round((prevDate - currDate) / 86400000);

      if (diffDays === 1) {
        current++;
      } else {
        break;
      }
    }
  }

  let longest = 1;
  let tempStreak = 1;

  const sortedAsc = [...doneDates].sort((a, b) => new Date(a) - new Date(b));
  for (let i = 1; i < sortedAsc.length; i++) {
    const prevDate = new Date(sortedAsc[i - 1]);
    const currDate = new Date(sortedAsc[i]);
    const diffDays = Math.round((currDate - prevDate) / 86400000);

    if (diffDays === 1) {
      tempStreak++;
      longest = Math.max(longest, tempStreak);
    } else if (diffDays > 1) {
      tempStreak = 1;
    }
  }

  return { current, longest };
}

// ============================================
// RENDERING
// ============================================

function getDisplayDates() {
  const dates = [];
  for (let i = DAYS_TO_SHOW - 1; i >= 0; i--) {
    const date = new Date(viewEndDate);
    date.setDate(date.getDate() - i);
    date.setHours(0, 0, 0, 0);
    dates.push(date);
  }
  return dates;
}

function renderDayHeaders() {
  const container = document.getElementById('dayHeaders');
  const today = formatDate(new Date());
  const dates = getDisplayDates();

  let html = '<div class="day-header">Habit</div>';

  for (const date of dates) {
    const dateStr = formatDate(date);
    const isToday = dateStr === today;

    html += `
      <div class="day-header ${isToday ? 'is-today' : ''}">
        ${getDayName(date)}
        <span class="day-date">${date.getDate()}</span>
      </div>
    `;
  }

  container.innerHTML = html;
  updateDateRangeLabel();
}

function renderHabits() {
  const container = document.getElementById('habitsList');
  const emptyState = document.getElementById('emptyState');
  const dates = getDisplayDates();

  if (habits.length === 0) {
    container.innerHTML = '';
    emptyState.hidden = false;
    return;
  }

  emptyState.hidden = true;

  const sortedHabits = [...habits].sort((a, b) => (a.order || 0) - (b.order || 0));

  let html = '';

  for (const habit of sortedHabits) {
    const streak = calculateStreak(habit.id);
    const streakText = streak.current > 0 ? `${streak.current}` : '';

    html += `
      <div class="habit-row" data-habit-id="${habit.id}" draggable="true">
        <div class="habit-info">
          <span class="drag-handle" title="Drag to reorder">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="5" cy="5" r="2"/><circle cx="12" cy="5" r="2"/><circle cx="19" cy="5" r="2"/>
              <circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/>
              <circle cx="5" cy="19" r="2"/><circle cx="12" cy="19" r="2"/><circle cx="19" cy="19" r="2"/>
            </svg>
          </span>
          <span class="habit-name">${escapeHtml(habit.name)}</span>
          ${streakText ? `<span class="habit-streak" title="${streak.current} day streak">${streakText}</span>` : ''}
          <button class="habit-delete" data-delete="${habit.id}" title="Delete habit">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
            </svg>
          </button>
        </div>
    `;

    for (const date of dates) {
      const dateStr = formatDate(date);
      const state = getHabitState(habit.id, dateStr);
      const stateLabel = state === 'done' ? 'Done' : state === 'skipped' ? 'Skipped' : 'Not tracked';
      const dayLabel = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

      const isToday = dateStr === formatDate(new Date());

      html += `
        <div class="habit-day ${isToday ? 'is-today' : ''}">
          <button
            class="habit-checkbox ${state === 'done' ? 'done' : ''} ${state === 'skipped' ? 'skipped' : ''}"
            data-habit="${habit.id}"
            data-date="${dateStr}"
            aria-label="${escapeHtml(habit.name)} on ${dayLabel}: ${stateLabel}"
          ></button>
        </div>
      `;
    }

    html += '</div>';
  }

  container.innerHTML = html;
  setupDragAndDrop();
}

function updateDateRangeLabel() {
  const label = document.getElementById('weekLabel');
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const viewEnd = new Date(viewEndDate);
  viewEnd.setHours(0, 0, 0, 0);

  if (viewEnd.getTime() === today.getTime()) {
    label.textContent = 'Last 14 Days';
  } else {
    const dates = getDisplayDates();
    const startDate = dates[0];
    const endDate = dates[dates.length - 1];

    const startMonth = startDate.toLocaleDateString('en-US', { month: 'short' });
    const endMonth = endDate.toLocaleDateString('en-US', { month: 'short' });

    if (startMonth === endMonth) {
      label.textContent = `${startMonth} ${startDate.getDate()} - ${endDate.getDate()}`;
    } else {
      label.textContent = `${startMonth} ${startDate.getDate()} - ${endMonth} ${endDate.getDate()}`;
    }
  }
}

// ============================================
// EVENT LISTENERS
// ============================================

function setupEventListeners() {
  // Add habit form
  document.getElementById('addHabitForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('habitInput');

    if (input.value.trim()) {
      addHabit(input.value);
      input.value = '';
    }
  });

  // Habit list click delegation
  document.getElementById('habitsList').addEventListener('click', (e) => {
    const checkbox = e.target.closest('.habit-checkbox');
    if (checkbox) {
      const habitId = checkbox.dataset.habit;
      const dateStr = checkbox.dataset.date;
      toggleCompletion(habitId, dateStr);
      return;
    }

    const deleteBtn = e.target.closest('.habit-delete');
    if (deleteBtn) {
      const habitId = deleteBtn.dataset.delete;
      deleteHabit(habitId);
      return;
    }
  });

  // Double-click to edit habit name
  document.getElementById('habitsList').addEventListener('dblclick', (e) => {
    const habitName = e.target.closest('.habit-name');
    if (habitName && !habitName.classList.contains('editing')) {
      const row = habitName.closest('.habit-row');
      const habitId = row.dataset.habitId;
      const currentName = habitName.textContent;

      // Replace with input
      habitName.classList.add('editing');
      habitName.innerHTML = `<input type="text" class="habit-name-input" value="${escapeHtml(currentName)}" maxlength="50">`;

      const input = habitName.querySelector('.habit-name-input');
      input.focus();
      input.select();

      // Save on blur or Enter
      const saveEdit = () => {
        const newName = input.value.trim();
        if (newName && newName !== currentName) {
          renameHabit(habitId, newName);
        } else {
          renderHabits(); // Revert
        }
      };

      input.addEventListener('blur', saveEdit);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          input.blur();
        } else if (e.key === 'Escape') {
          input.value = currentName;
          input.blur();
        }
      });
    }
  });

  // Date navigation
  document.getElementById('prevWeek').addEventListener('click', () => {
    viewEndDate.setDate(viewEndDate.getDate() - 14);
    renderDayHeaders();
    renderHabits();
  });

  document.getElementById('nextWeek').addEventListener('click', () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const proposedEnd = new Date(viewEndDate);
    proposedEnd.setDate(proposedEnd.getDate() + 14);

    if (proposedEnd <= today) {
      viewEndDate = proposedEnd;
    } else {
      viewEndDate = today;
    }
    renderDayHeaders();
    renderHabits();
  });

  document.getElementById('todayBtn').addEventListener('click', () => {
    viewEndDate = new Date();
    renderDayHeaders();
    renderHabits();
  });

  // Export/Import
  document.getElementById('exportBtn').addEventListener('click', exportData);
  document.getElementById('importBtn').addEventListener('click', () => {
    document.getElementById('importFile').click();
  });
  document.getElementById('importFile').addEventListener('change', importData);

  // Modal
  document.querySelector('.modal-backdrop')?.addEventListener('click', hideConfirm);
  document.getElementById('confirmCancel').addEventListener('click', hideConfirm);
}

// ============================================
// EXPORT / IMPORT
// ============================================

function exportData() {
  const data = {
    version: 1,
    exportedAt: new Date().toISOString(),
    habits: habits,
    completions: completions
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `habits-backup-${formatDate(new Date())}.json`;
  a.click();

  URL.revokeObjectURL(url);
  showToast('Data exported');
}

async function importData(event) {
  const file = event.target.files[0];
  if (!file) return;

  try {
    const text = await file.text();
    const data = JSON.parse(text);

    if (!data.habits || !Array.isArray(data.habits)) {
      throw new Error('Invalid file format');
    }

    // Validate each habit has the required fields
    for (const habit of data.habits) {
      if (!habit.id || typeof habit.id !== 'string' ||
          !habit.name || typeof habit.name !== 'string') {
        throw new Error('Invalid habit data: each habit must have an id and name');
      }
    }

    // Validate completions structure if present
    if (data.completions && typeof data.completions !== 'object') {
      throw new Error('Invalid completions data');
    }

    showConfirm(
      'Import data?',
      `This will replace your current ${habits.length} habits with ${data.habits.length} habits from the backup.`,
      async () => {
        habits = data.habits;
        completions = data.completions || {};

        await saveHabits();
        await saveCompletions();
        renderHabits();

        showToast('Data imported successfully');
      }
    );
  } catch (error) {
    console.error('Import failed:', error);
    showToast('Failed to import: Invalid file');
  }

  event.target.value = '';
}

// ============================================
// CONFIRMATION MODAL
// ============================================

let confirmCallback = null;
let previouslyFocusedElement = null;

function showConfirm(title, message, onConfirm) {
  document.getElementById('confirmTitle').textContent = title;
  document.getElementById('confirmMessage').textContent = message;
  document.getElementById('confirmModal').hidden = false;

  // Remember what was focused so we can restore it when the modal closes
  previouslyFocusedElement = document.activeElement;

  confirmCallback = onConfirm;

  const confirmBtn = document.getElementById('confirmOk');
  const cancelBtn = document.getElementById('confirmCancel');

  confirmBtn.onclick = () => {
    hideConfirm();
    if (confirmCallback) confirmCallback();
  };

  // Focus the cancel button by default (safer action)
  cancelBtn.focus();

  // Trap focus inside the modal
  const modal = document.getElementById('confirmModal');
  modal.addEventListener('keydown', trapFocus);
}

function hideConfirm() {
  const modal = document.getElementById('confirmModal');
  modal.hidden = true;
  modal.removeEventListener('keydown', trapFocus);
  confirmCallback = null;

  // Restore focus to the element that opened the modal
  if (previouslyFocusedElement) {
    previouslyFocusedElement.focus();
    previouslyFocusedElement = null;
  }
}

// Keep Tab/Shift+Tab cycling within the modal buttons
function trapFocus(e) {
  if (e.key === 'Escape') {
    hideConfirm();
    return;
  }
  if (e.key !== 'Tab') return;

  const cancelBtn = document.getElementById('confirmCancel');
  const confirmBtn = document.getElementById('confirmOk');

  if (e.shiftKey && document.activeElement === cancelBtn) {
    e.preventDefault();
    confirmBtn.focus();
  } else if (!e.shiftKey && document.activeElement === confirmBtn) {
    e.preventDefault();
    cancelBtn.focus();
  }
}

// ============================================
// TOAST NOTIFICATIONS
// ============================================

let toastTimeout = null;

function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.hidden = false;

  // Clear any existing timeout so rapid toasts don't cut each other short
  if (toastTimeout) clearTimeout(toastTimeout);

  toastTimeout = setTimeout(() => {
    toast.hidden = true;
    toastTimeout = null;
  }, 2500);
}

// ============================================
// DRAG AND DROP
// ============================================

function setupDragAndDrop() {
  const rows = document.querySelectorAll('.habit-row');

  rows.forEach((row, index) => {
    row.addEventListener('dragstart', (e) => {
      draggedHabit = { element: row, index: index };
      row.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });

    row.addEventListener('dragend', () => {
      row.classList.remove('dragging');
      draggedHabit = null;
      document.querySelectorAll('.habit-row').forEach(r => r.classList.remove('drag-over'));
    });

    row.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';

      if (draggedHabit && draggedHabit.element !== row) {
        row.classList.add('drag-over');
      }
    });

    row.addEventListener('dragleave', () => {
      row.classList.remove('drag-over');
    });

    row.addEventListener('drop', (e) => {
      e.preventDefault();
      row.classList.remove('drag-over');

      if (draggedHabit && draggedHabit.element !== row) {
        reorderHabits(draggedHabit.index, index);
      }
    });
  });
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 11);
}

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getDayName(date) {
  return date.toLocaleDateString('en-US', { weekday: 'short' });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ============================================
// NEW TAB TOGGLE
// ============================================

function setupNewTabToggle() {
  const btn = document.getElementById('newTabToggle');

  // Load current state
  chrome.storage.local.get('useAsNewTab', (result) => {
    updateNewTabButton(btn, !!result.useAsNewTab);
  });

  btn.addEventListener('click', () => {
    chrome.storage.local.get('useAsNewTab', (result) => {
      const newValue = !result.useAsNewTab;
      chrome.storage.local.set({ useAsNewTab: newValue }, () => {
        updateNewTabButton(btn, newValue);
        showToast(newValue ? 'Habits will show on new tabs' : 'New tabs back to default');
      });
    });
  });
}

function updateNewTabButton(btn, enabled) {
  if (enabled) {
    btn.classList.add('btn-active');
    btn.title = 'New tab override is on — click to turn off';
  } else {
    btn.classList.remove('btn-active');
    btn.title = 'Use as new tab page';
  }
}
