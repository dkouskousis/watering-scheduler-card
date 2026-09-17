const CARD_VERSION = "1.0.0";

class WateringSchedulerCard extends HTMLElement {
  static getStubConfig() {
    return {
      type: "custom:watering-scheduler-card",
      title: "Πότισμα μπροστινού μπαλκονιού",
      enabled_entity: "input_boolean.watering_front_balcony",
      days_entity: "input_number.watering_front_balcony_days",
      time_entity: "input_datetime.watering_front_balcony_start_time",
      duration_entity: "input_number.watering_front_balcony_duration",
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
      ...config,
    };
    this._pendingMask = null;
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  getCardSize() {
    return 4;
  }

  _labels() {
    if (this._config.language === "en") {
      return {
        days: ["M", "T", "W", "T", "F", "S", "S"],
        dayNames: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
        start: "Start time",
        duration: "Duration",
        next: "Next watering",
        none: "No watering days selected",
        missing: "Entity not found",
        minutes: "min",
      };
    }

    return {
      days: ["Δ", "Τ", "Τ", "Π", "Π", "Σ", "Κ"],
      dayNames: ["Δευτέρα", "Τρίτη", "Τετάρτη", "Πέμπτη", "Παρασκευή", "Σάββατο", "Κυριακή"],
      start: "Ώρα έναρξης",
      duration: "Διάρκεια",
      next: "Επόμενο πότισμα",
      none: "Δεν έχει επιλεγεί ημέρα",
      missing: "Δεν βρέθηκε το entity",
      minutes: "λεπτά",
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

  _render() {
    if (!this._config || !this._hass) return;

    const labels = this._labels();
    const daysState = this._state(this._config.days_entity);
    const timeState = this._state(this._config.time_entity);
    const durationState = this._state(this._config.duration_entity);
    const enabledState = this._state(this._config.enabled_entity);
    const required = [
      [this._config.days_entity, daysState],
      [this._config.time_entity, timeState],
      [this._config.duration_entity, durationState],
    ];
    const missing = required.filter(([, state]) => !state).map(([id]) => id);

    if (missing.length) {
      this.innerHTML = `
        <ha-card>
          <div class="error">${labels.missing}: ${missing.join(", ")}</div>
        </ha-card>
        ${this._styles()}
      `;
      return;
    }

    const actualMask = Math.round(Number(daysState.state));
    if (this._pendingMask !== null && actualMask === this._pendingMask) {
      this._pendingMask = null;
    }
    const mask = this._mask();
    const time = this._timeValue(timeState);
    const duration = Number(durationState.state);
    const min = Number(durationState.attributes.min ?? 1);
    const max = Number(durationState.attributes.max ?? 60);
    const step = Number(durationState.attributes.step ?? 1);
    const enabled = !this._config.enabled_entity || enabledState?.state === "on";

    this.innerHTML = `
      <ha-card class="watering-card ${enabled ? "" : "disabled"}">
        <div class="header">
          <div class="heading">
            <ha-icon icon="${this._config.icon}"></ha-icon>
            <div>
              <div class="title">${this._config.title}</div>
              <div class="next">${labels.next}: ${this._nextRun(mask, time)}</div>
            </div>
          </div>
          ${this._config.enabled_entity ? `<ha-switch id="enabled" ${enabled ? "checked" : ""}></ha-switch>` : ""}
        </div>

        <div class="days" role="group" aria-label="Days">
          ${labels.days.map((day, index) => `
            <button
              class="day ${(mask & (1 << index)) ? "selected" : ""}"
              data-day="${index}"
              title="${labels.dayNames[index]}"
              aria-label="${labels.dayNames[index]}"
              aria-pressed="${Boolean(mask & (1 << index))}"
            >${day}</button>
          `).join("")}
        </div>

        <div class="control-grid">
          <label class="control">
            <span><ha-icon icon="mdi:clock-outline"></ha-icon>${labels.start}</span>
            <input id="start-time" type="time" value="${time}">
          </label>

          <label class="control duration-control">
            <span><ha-icon icon="mdi:timer-outline"></ha-icon>${labels.duration}</span>
            <strong id="duration-value">${duration} ${this._config.duration_unit || labels.minutes}</strong>
            <input id="duration" type="range" min="${min}" max="${max}" step="${step}" value="${duration}">
          </label>
        </div>
      </ha-card>
      ${this._styles()}
    `;

    this.querySelectorAll("[data-day]").forEach((button) => {
      button.addEventListener("click", () => this._toggleDay(Number(button.dataset.day)));
    });

    this.querySelector("#start-time")?.addEventListener("change", (event) => {
      this._setTime(event.target.value);
    });

    const durationInput = this.querySelector("#duration");
    durationInput?.addEventListener("input", (event) => {
      this.querySelector("#duration-value").textContent = `${event.target.value} ${this._config.duration_unit || labels.minutes}`;
    });
    durationInput?.addEventListener("change", (event) => {
      this._setDuration(event.target.value);
    });

    this.querySelector("#enabled")?.addEventListener("change", () => this._toggleEnabled());
  }

  _styles() {
    return `
      <style>
        ha-card.watering-card {
          padding: 20px;
          overflow: hidden;
          transition: opacity 180ms ease;
        }
        ha-card.disabled .days,
        ha-card.disabled .control-grid {
          opacity: 0.48;
        }
        .header,
        .heading,
        .control span {
          display: flex;
          align-items: center;
        }
        .header {
          justify-content: space-between;
          gap: 16px;
          margin-bottom: 20px;
        }
        .heading {
          min-width: 0;
          gap: 13px;
        }
        .heading > ha-icon {
          --mdc-icon-size: 28px;
          color: var(--primary-color);
          flex: 0 0 auto;
        }
        .title {
          color: var(--primary-text-color);
          font-size: 17px;
          font-weight: 600;
          line-height: 1.25;
        }
        .next {
          color: var(--secondary-text-color);
          font-size: 12px;
          line-height: 1.35;
          margin-top: 3px;
          text-transform: capitalize;
        }
        .days {
          display: grid;
          grid-template-columns: repeat(7, 1fr);
          gap: 7px;
          margin-bottom: 22px;
          transition: opacity 180ms ease;
        }
        .day {
          appearance: none;
          min-width: 0;
          min-height: 44px;
          border: 1px solid var(--divider-color);
          border-radius: 14px;
          background: var(--secondary-background-color);
          color: var(--secondary-text-color);
          font: inherit;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          -webkit-tap-highlight-color: transparent;
          transition: background 140ms ease, color 140ms ease, border-color 140ms ease, transform 80ms ease;
        }
        .day:active {
          transform: scale(0.94);
        }
        .day.selected {
          border-color: var(--primary-color);
          background: var(--primary-color);
          color: var(--text-primary-color, #fff);
        }
        .control-grid {
          display: grid;
          grid-template-columns: minmax(120px, 0.8fr) minmax(180px, 1.5fr);
          gap: 18px;
          transition: opacity 180ms ease;
        }
        .control {
          min-width: 0;
          color: var(--secondary-text-color);
          font-size: 13px;
        }
        .control span {
          gap: 7px;
          margin-bottom: 9px;
        }
        .control span ha-icon {
          --mdc-icon-size: 18px;
        }
        .control input[type="time"] {
          box-sizing: border-box;
          width: 100%;
          min-height: 46px;
          padding: 8px 12px;
          border: 1px solid var(--divider-color);
          border-radius: 12px;
          outline: none;
          background: var(--secondary-background-color);
          color: var(--primary-text-color);
          color-scheme: light dark;
          font: inherit;
          font-size: 16px;
        }
        .control input[type="time"]:focus {
          border-color: var(--primary-color);
        }
        .duration-control {
          display: grid;
          grid-template-columns: 1fr auto;
          align-items: center;
          column-gap: 12px;
        }
        .duration-control strong {
          color: var(--primary-text-color);
          font-size: 14px;
          font-weight: 600;
        }
        .duration-control input {
          grid-column: 1 / -1;
          width: 100%;
          min-height: 28px;
          accent-color: var(--primary-color);
          cursor: pointer;
        }
        .error {
          padding: 18px;
          color: var(--error-color);
        }
        @media (max-width: 520px) {
          ha-card.watering-card {
            padding: 16px;
          }
          .days {
            gap: 5px;
          }
          .day {
            min-height: 42px;
            border-radius: 12px;
          }
          .control-grid {
            grid-template-columns: 1fr;
            gap: 16px;
          }
        }
      </style>
    `;
  }
}

if (!customElements.get("watering-scheduler-card")) {
  customElements.define("watering-scheduler-card", WateringSchedulerCard);
}

window.customCards = window.customCards || [];
window.customCards.push({
  type: "watering-scheduler-card",
  name: "Watering Scheduler Card",
  description: "Mobile-friendly weekly watering schedule card.",
  preview: true,
});

console.info(`%c WATERING-SCHEDULER-CARD %c v${CARD_VERSION} `, "color:white;background:#2e7d32;font-weight:700", "color:#2e7d32;background:white");
