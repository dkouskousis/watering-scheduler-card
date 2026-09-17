const CARD_VERSION = "1.1.0";

class WateringSchedulerCard extends HTMLElement {
  static getStubConfig() {
    return {
      type: "custom:watering-scheduler-card",
      title: "Πότισμα μπροστινού μπαλκονιού",
      enabled_entity: "input_boolean.watering_front_balcony",
      mode_entity: "input_select.watering_front_balcony_mode",
      days_entity: "input_number.watering_front_balcony_days",
      time_entity: "input_datetime.watering_front_balcony_start_time",
      duration_entity: "input_number.watering_front_balcony_duration",
      weather_entity: "weather.openweathermap",
      log_entity: "switch.watering_front_balcony",
      language: "el",
    };
  }

  setConfig(config) {
    if (!config.days_entity || !config.time_entity || !config.duration_entity) {
      throw new Error("days_entity, time_entity και duration_entity είναι υποχρεωτικά");
    }

    this._config = {
      title: "Πρόγραμμα ποτίσματος",
      icon: "mdi:sprinkler-variant",
      language: "el",
      manual_value: "Manual",
      auto_value: "Auto",
      log_days: 90,
      active_states: ["on", "open", "opening"],
      ...config,
    };
    this._pendingMask = null;
    this._history = [];
    this._historyError = "";
    this._historyLoading = false;
    this._lastHistoryFetch = 0;
    this._lastLogSignature = "";
    this._render();
  }

  set hass(hass) {
    const logEntity = this._config?.log_entity;
    const logState = logEntity ? hass.states[logEntity] : undefined;
    const signature = logState ? `${logState.state}:${logState.last_changed}` : "";
    if (signature !== this._lastLogSignature) {
      this._lastLogSignature = signature;
      this._lastHistoryFetch = 0;
    }
    this._hass = hass;
    this._render();
    this._loadHistory();
  }

  getCardSize() {
    return this._config?.log_entity ? 8 : 5;
  }

  _labels() {
    if (this._config.language === "en") {
      return {
        days: ["M", "T", "W", "T", "F", "S", "S"],
        dayNames: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
        start: "Start time",
        duration: "Duration",
        baseDuration: "Base duration",
        next: "Next watering",
        none: "No watering days selected",
        missing: "Entity not found",
        minutes: "min",
        seconds: "sec",
        manual: "Manual",
        auto: "Auto",
        autoHint: "Automatically adjusted using the weather forecast",
        history: "Last watering runs",
        noHistory: "No watering history found",
        loading: "Loading history…",
        historyError: "Could not load history",
        refresh: "Refresh history",
      };
    }

    return {
      days: ["Δ", "Τ", "Τ", "Π", "Π", "Σ", "Κ"],
      dayNames: ["Δευτέρα", "Τρίτη", "Τετάρτη", "Πέμπτη", "Παρασκευή", "Σάββατο", "Κυριακή"],
      start: "Ώρα έναρξης",
      duration: "Διάρκεια",
      baseDuration: "Βασική διάρκεια",
      next: "Επόμενο πότισμα",
      none: "Δεν έχει επιλεγεί ημέρα",
      missing: "Δεν βρέθηκε το entity",
      minutes: "λεπτά",
      seconds: "δευτ.",
      manual: "Manual",
      auto: "Auto",
      autoHint: "Αυτόματη προσαρμογή από την πρόγνωση καιρού",
      history: "Τελευταία ποτίσματα",
      noHistory: "Δεν βρέθηκε ιστορικό ποτίσματος",
      loading: "Φόρτωση ιστορικού…",
      historyError: "Δεν ήταν δυνατή η φόρτωση του ιστορικού",
      refresh: "Ανανέωση ιστορικού",
    };
  }

  _state(entityId) {
    return entityId && this._hass ? this._hass.states[entityId] : undefined;
  }

  _timeValue(state) {
    if (!state) return "00:00";
    return String(state.state).slice(0, 5);
  }

  _mask() {
    if (this._pendingMask !== null) return this._pendingMask;
    const value = Number(this._state(this._config.days_entity)?.state ?? 0);
    return Number.isFinite(value) ? Math.max(0, Math.min(127, Math.round(value))) : 0;
  }

  _isAuto() {
    if (!this._config.mode_entity) return false;
    return this._state(this._config.mode_entity)?.state === this._config.auto_value;
  }

  _nextRun(mask, time) {
    const labels = this._labels();
    if (mask === 0) return labels.none;
    const [hour, minute] = time.split(":").map(Number);
    const now = new Date();

    for (let offset = 0; offset < 8; offset += 1) {
      const candidate = new Date(now);
      candidate.setHours(hour, minute, 0, 0);
      candidate.setDate(now.getDate() + offset);
      const mondayIndex = (candidate.getDay() + 6) % 7;
      if ((mask & (1 << mondayIndex)) && candidate > now) {
        const locale = this._config.language === "en" ? "en-GB" : "el-GR";
        return new Intl.DateTimeFormat(locale, {
          weekday: "long",
          hour: "2-digit",
          minute: "2-digit",
        }).format(candidate);
      }
    }
    return labels.none;
  }

  _weatherSummary() {
    const state = this._state(this._config.weather_entity);
    if (!state) return "";
    const temperature = state.attributes.temperature;
    const unit = state.attributes.temperature_unit || "°C";
    return temperature === undefined ? state.state : `${temperature}${unit}`;
  }

  async _toggleDay(index) {
    const current = this._mask();
    const next = current ^ (1 << index);
    this._pendingMask = next;
    this._render();
    await this._hass.callService("input_number", "set_value", {
      entity_id: this._config.days_entity,
      value: next,
    });
  }

  async _setMode(value) {
    if (!this._config.mode_entity) return;
    await this._hass.callService("input_select", "select_option", {
      entity_id: this._config.mode_entity,
      option: value,
    });
  }

  async _setTime(value) {
    await this._hass.callService("input_datetime", "set_datetime", {
      entity_id: this._config.time_entity,
      time: `${value}:00`,
    });
  }

  async _setDuration(value) {
    await this._hass.callService("input_number", "set_value", {
      entity_id: this._config.duration_entity,
      value: Number(value),
    });
  }

  async _toggleEnabled() {
    if (!this._config.enabled_entity) return;
    await this._hass.callService("input_boolean", "toggle", {
      entity_id: this._config.enabled_entity,
    });
  }

  async _loadHistory(force = false) {
    if (!this._hass || !this._config.log_entity || this._historyLoading) return;
    if (!force && Date.now() - this._lastHistoryFetch < 300000) return;
    this._historyLoading = true;
    this._historyError = "";
    this._render();

    try {
      const start = new Date();
      start.setDate(start.getDate() - Number(this._config.log_days));
      const entityId = encodeURIComponent(this._config.log_entity);
      const timestamp = encodeURIComponent(start.toISOString());
      const path = `history/period/${timestamp}?filter_entity_id=${entityId}&minimal_response&no_attributes&significant_changes_only`;
      const response = await this._hass.callApi("GET", path);
      const states = Array.isArray(response?.[0]) ? response[0] : [];
      this._history = this._parseHistory(states).slice(0, 10);
      this._lastHistoryFetch = Date.now();
    } catch (error) {
      this._historyError = error?.message || "history_error";
    } finally {
      this._historyLoading = false;
      this._render();
    }
  }

  _parseHistory(states) {
    const activeStates = new Set(this._config.active_states.map((state) => String(state).toLowerCase()));
    const ordered = [...states].sort((a, b) => new Date(a.last_changed) - new Date(b.last_changed));
    const entries = [];
    let startedAt = null;

    for (const state of ordered) {
      const active = activeStates.has(String(state.state).toLowerCase());
      const changedAt = new Date(state.last_changed);
      if (active && !startedAt) {
        startedAt = changedAt;
      } else if (!active && startedAt) {
        const seconds = Math.max(0, Math.round((changedAt - startedAt) / 1000));
        if (seconds > 0) entries.push({ startedAt, endedAt: changedAt, seconds });
        startedAt = null;
      }
    }
    if (startedAt) {
      entries.push({ startedAt, endedAt: null, seconds: Math.max(0, Math.round((Date.now() - startedAt) / 1000)) });
    }
    return entries.reverse();
  }

  _formatLogDate(date) {
    const locale = this._config.language === "en" ? "en-GB" : "el-GR";
    return new Intl.DateTimeFormat(locale, {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  }

  _formatDuration(seconds) {
    const labels = this._labels();
    if (seconds < 60) return `${seconds} ${labels.seconds}`;
    return `${Math.round(seconds / 6) / 10} ${labels.minutes}`;
  }

  _historyMarkup() {
    if (!this._config.log_entity) return "";
    const labels = this._labels();
    let body = `<div class="history-empty">${labels.noHistory}</div>`;
    if (this._historyLoading) body = `<div class="history-empty">${labels.loading}</div>`;
    else if (this._historyError) body = `<div class="history-empty error-text">${labels.historyError}</div>`;
    else if (this._history.length) {
      body = this._history.map((entry) => `
        <div class="history-row">
          <div class="history-date"><ha-icon icon="mdi:water-outline"></ha-icon><span>${this._formatLogDate(entry.startedAt)}</span></div>
          <strong>${this._formatDuration(entry.seconds)}</strong>
        </div>
      `).join("");
    }

    return `
      <div class="history-section">
        <div class="history-header">
          <span>${labels.history}</span>
          <button id="refresh-history" title="${labels.refresh}" aria-label="${labels.refresh}"><ha-icon icon="mdi:refresh"></ha-icon></button>
        </div>
        <div class="history-list">${body}</div>
      </div>
    `;
  }

  _render() {
    if (!this._config || !this._hass) return;
    const labels = this._labels();
    const daysState = this._state(this._config.days_entity);
    const timeState = this._state(this._config.time_entity);
    const durationState = this._state(this._config.duration_entity);
    const enabledState = this._state(this._config.enabled_entity);
    const modeState = this._state(this._config.mode_entity);
    const required = [
      [this._config.days_entity, daysState],
      [this._config.time_entity, timeState],
      [this._config.duration_entity, durationState],
      ...(this._config.mode_entity ? [[this._config.mode_entity, modeState]] : []),
    ];
    const missing = required.filter(([, state]) => !state).map(([id]) => id);

    if (missing.length) {
      this.innerHTML = `<ha-card><div class="error">${labels.missing}: ${missing.join(", ")}</div></ha-card>${this._styles()}`;
      return;
    }

    const actualMask = Math.round(Number(daysState.state));
    if (this._pendingMask !== null && actualMask === this._pendingMask) this._pendingMask = null;
    const mask = this._mask();
    const time = this._timeValue(timeState);
    const duration = Number(durationState.state);
    const min = Number(durationState.attributes.min ?? 1);
    const max = Number(durationState.attributes.max ?? 60);
    const step = Number(durationState.attributes.step ?? 1);
    const enabled = !this._config.enabled_entity || enabledState?.state === "on";
    const isAuto = this._isAuto();
    const weather = this._weatherSummary();

    this.innerHTML = `
      <ha-card class="watering-card ${enabled ? "" : "disabled"}">
        <div class="header">
          <div class="heading">
            <ha-icon icon="${this._config.icon}"></ha-icon>
            <div><div class="title">${this._config.title}</div><div class="next">${labels.next}: ${this._nextRun(mask, time)}</div></div>
          </div>
          ${this._config.enabled_entity ? `<ha-switch id="enabled" ${enabled ? "checked" : ""}></ha-switch>` : ""}
        </div>

        ${this._config.mode_entity ? `
          <div class="mode-wrap">
            <div class="mode-selector" role="group" aria-label="Mode">
              <button class="mode-button ${isAuto ? "" : "selected"}" data-mode="${this._config.manual_value}">${labels.manual}</button>
              <button class="mode-button ${isAuto ? "selected" : ""}" data-mode="${this._config.auto_value}">${labels.auto}</button>
            </div>
            ${isAuto ? `<div class="auto-hint"><ha-icon icon="mdi:weather-partly-cloudy"></ha-icon>${labels.autoHint}${weather ? ` · ${weather}` : ""}</div>` : ""}
          </div>
        ` : ""}

        <div class="days" role="group" aria-label="Days">
          ${labels.days.map((day, index) => `
            <button class="day ${(mask & (1 << index)) ? "selected" : ""}" data-day="${index}" title="${labels.dayNames[index]}" aria-label="${labels.dayNames[index]}" aria-pressed="${Boolean(mask & (1 << index))}">${day}</button>
          `).join("")}
        </div>

        <div class="control-grid">
          <label class="control">
            <span><ha-icon icon="mdi:clock-outline"></ha-icon>${labels.start}</span>
            <input id="start-time" type="time" value="${time}">
          </label>
          <label class="control duration-control">
            <span><ha-icon icon="mdi:timer-outline"></ha-icon>${isAuto ? labels.baseDuration : labels.duration}</span>
            <strong id="duration-value">${duration} ${this._config.duration_unit || labels.minutes}</strong>
            <input id="duration" type="range" min="${min}" max="${max}" step="${step}" value="${duration}">
          </label>
        </div>
        ${this._historyMarkup()}
      </ha-card>
      ${this._styles()}
    `;

    this.querySelectorAll("[data-day]").forEach((button) => button.addEventListener("click", () => this._toggleDay(Number(button.dataset.day))));
    this.querySelectorAll("[data-mode]").forEach((button) => button.addEventListener("click", () => this._setMode(button.dataset.mode)));
    this.querySelector("#start-time")?.addEventListener("change", (event) => this._setTime(event.target.value));
    const durationInput = this.querySelector("#duration");
    durationInput?.addEventListener("input", (event) => {
      this.querySelector("#duration-value").textContent = `${event.target.value} ${this._config.duration_unit || labels.minutes}`;
    });
    durationInput?.addEventListener("change", (event) => this._setDuration(event.target.value));
    this.querySelector("#enabled")?.addEventListener("change", () => this._toggleEnabled());
    this.querySelector("#refresh-history")?.addEventListener("click", () => {
      this._lastHistoryFetch = 0;
      this._loadHistory(true);
    });
  }

  _styles() {
    return `
      <style>
        ha-card.watering-card { padding:20px; overflow:hidden; transition:opacity 180ms ease; }
        ha-card.disabled .days, ha-card.disabled .control-grid, ha-card.disabled .mode-wrap { opacity:.48; }
        .header,.heading,.control span,.auto-hint,.history-date,.history-header { display:flex; align-items:center; }
        .header { justify-content:space-between; gap:16px; margin-bottom:18px; }
        .heading { min-width:0; gap:13px; }
        .heading > ha-icon { --mdc-icon-size:28px; color:var(--primary-color); flex:0 0 auto; }
        .title { color:var(--primary-text-color); font-size:17px; font-weight:600; line-height:1.25; }
        .next,.auto-hint { color:var(--secondary-text-color); font-size:12px; line-height:1.35; }
        .next { margin-top:3px; text-transform:capitalize; }
        .mode-wrap { margin-bottom:18px; transition:opacity 180ms ease; }
        .mode-selector { display:grid; grid-template-columns:1fr 1fr; gap:4px; padding:4px; border-radius:14px; background:var(--secondary-background-color); }
        .mode-button { min-height:40px; border:0; border-radius:11px; background:transparent; color:var(--secondary-text-color); font:inherit; font-weight:600; cursor:pointer; }
        .mode-button.selected { background:var(--card-background-color,var(--ha-card-background)); color:var(--primary-color); box-shadow:0 1px 5px rgba(0,0,0,.14); }
        .auto-hint { gap:6px; margin:8px 4px 0; }
        .auto-hint ha-icon { --mdc-icon-size:17px; }
        .days { display:grid; grid-template-columns:repeat(7,1fr); gap:7px; margin-bottom:22px; transition:opacity 180ms ease; }
        .day { appearance:none; min-width:0; min-height:44px; border:1px solid var(--divider-color); border-radius:14px; background:var(--secondary-background-color); color:var(--secondary-text-color); font:inherit; font-size:14px; font-weight:600; cursor:pointer; -webkit-tap-highlight-color:transparent; transition:background 140ms ease,color 140ms ease,border-color 140ms ease,transform 80ms ease; }
        .day:active { transform:scale(.94); }
        .day.selected { border-color:var(--primary-color); background:var(--primary-color); color:var(--text-primary-color,#fff); }
        .control-grid { display:grid; grid-template-columns:minmax(120px,.8fr) minmax(180px,1.5fr); gap:18px; transition:opacity 180ms ease; }
        .control { min-width:0; color:var(--secondary-text-color); font-size:13px; }
        .control span { gap:7px; margin-bottom:9px; }
        .control span ha-icon { --mdc-icon-size:18px; }
        .control input[type="time"] { box-sizing:border-box; width:100%; min-height:46px; padding:8px 12px; border:1px solid var(--divider-color); border-radius:12px; outline:none; background:var(--secondary-background-color); color:var(--primary-text-color); color-scheme:light dark; font:inherit; font-size:16px; }
        .control input[type="time"]:focus { border-color:var(--primary-color); }
        .duration-control { display:grid; grid-template-columns:1fr auto; align-items:center; column-gap:12px; }
        .duration-control strong { color:var(--primary-text-color); font-size:14px; font-weight:600; }
        .duration-control input { grid-column:1/-1; width:100%; min-height:28px; accent-color:var(--primary-color); cursor:pointer; }
        .history-section { margin:20px -20px -20px; padding:17px 20px 10px; border-top:1px solid var(--divider-color); background:color-mix(in srgb,var(--secondary-background-color) 45%,transparent); }
        .history-header { justify-content:space-between; color:var(--primary-text-color); font-size:14px; font-weight:600; margin-bottom:7px; }
        .history-header button { width:36px; height:36px; border:0; border-radius:50%; background:transparent; color:var(--secondary-text-color); cursor:pointer; }
        .history-header button:hover { background:var(--secondary-background-color); }
        .history-header ha-icon { --mdc-icon-size:19px; }
        .history-row { display:flex; align-items:center; justify-content:space-between; gap:12px; min-height:40px; border-top:1px solid color-mix(in srgb,var(--divider-color) 60%,transparent); color:var(--secondary-text-color); font-size:13px; }
        .history-date { gap:9px; }
        .history-date ha-icon { --mdc-icon-size:17px; color:var(--primary-color); }
        .history-row strong { color:var(--primary-text-color); font-size:13px; }
        .history-empty { padding:12px 0 18px; color:var(--secondary-text-color); font-size:13px; }
        .error,.error-text { color:var(--error-color); }
        .error { padding:18px; }
        @media (max-width:520px) {
          ha-card.watering-card { padding:16px; }
          .days { gap:5px; }
          .day { min-height:42px; border-radius:12px; }
          .control-grid { grid-template-columns:1fr; gap:16px; }
          .history-section { margin:18px -16px -16px; padding:15px 16px 8px; }
        }
      </style>
    `;
  }
}

if (!customElements.get("watering-scheduler-card")) customElements.define("watering-scheduler-card", WateringSchedulerCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: "watering-scheduler-card",
  name: "Watering Scheduler Card",
  description: "Mobile-friendly weekly watering schedule card with automatic mode and history.",
  preview: true,
});
console.info(`%c WATERING-SCHEDULER-CARD %c v${CARD_VERSION} `,"color:white;background:#2e7d32;font-weight:700","color:#2e7d32;background:white");
