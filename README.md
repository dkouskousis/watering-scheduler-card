# Watering Scheduler Card

Mobile-friendly Home Assistant dashboard card for choosing watering days, start time, duration, Manual/Auto mode and enabled state. It can also show the 10 most recent watering runs from Home Assistant history.

The seven selected days are stored as a single number from `0` to `127`, so each watering controller needs only one additional helper.

## HACS installation

1. Upload this repository to GitHub with the repository name `watering-scheduler-card`.
2. In HACS, open **Custom repositories**.
3. Paste the GitHub repository URL and select **Dashboard** as the category.
4. Install **Watering Scheduler Card**.
5. Refresh the browser. If the card is not loaded automatically, add `/hacsfiles/watering-scheduler-card/watering-scheduler-card.js` as a JavaScript module under **Settings → Dashboards → Resources**.

## Required helpers

Create one Number helper for the selected days of each balcony:

| Setting | Value |
| --- | --- |
| Minimum | `0` |
| Maximum | `127` |
| Step | `1` |
| Display mode | Input field |

Suggested entity IDs:

```yaml
input_number.watering_front_balcony_days
input_number.watering_back_balcony_days
```

Create one Dropdown helper for each balcony with exactly these two options:

```text
Manual
Auto
```

Suggested entity IDs:

```yaml
input_select.watering_front_balcony_mode
input_select.watering_back_balcony_mode
```

The card also uses the existing Time, Duration and Enabled helpers. In Auto mode, Duration is treated as the base duration that the automation adjusts using the weather forecast.

## Dashboard configuration

Front balcony:

```yaml
type: custom:watering-scheduler-card
title: Πότισμα μπροστινού μπαλκονιού
icon: mdi:sprinkler-variant
enabled_entity: input_boolean.watering_front_balcony
mode_entity: input_select.watering_front_balcony_mode
days_entity: input_number.watering_front_balcony_days
time_entity: input_datetime.watering_front_balcony_start_time
duration_entity: input_number.watering_front_balcony_duration
weather_entity: weather.openweathermap
log_entity: switch.watering_front_balcony
language: el
```

Back balcony:

```yaml
type: custom:watering-scheduler-card
title: Πότισμα πίσω μπαλκονιού
icon: mdi:sprinkler-variant
enabled_entity: input_boolean.watering_back_balcony
mode_entity: input_select.watering_back_balcony_mode
days_entity: input_number.watering_back_balcony_days
time_entity: input_datetime.watering_back_balcony_start_time
duration_entity: input_number.watering_back_balcony_duration
weather_entity: weather.openweathermap
log_entity: switch.watering_back_balcony
language: el
```

Replace the entity IDs with the actual IDs used by your Home Assistant.

## Automation condition

Add this condition to the front balcony automation:

```yaml
- condition: template
  value_template: >-
    {% set mask = states('input_number.watering_front_balcony_days') | int(0) %}
    {% set today_bit = 2 ** now().weekday() %}
    {{ (mask | bitwise_and(today_bit)) > 0 }}
```

For the back balcony:

```yaml
- condition: template
  value_template: >-
    {% set mask = states('input_number.watering_back_balcony_days') | int(0) %}
    {% set today_bit = 2 ** now().weekday() %}
    {{ (mask | bitwise_and(today_bit)) > 0 }}
```

Bit values are Monday `1`, Tuesday `2`, Wednesday `4`, Thursday `8`, Friday `16`, Saturday `32`, Sunday `64`. The card handles these values automatically.

## Options

| Option | Required | Description |
| --- | --- | --- |
| `days_entity` | Yes | Number helper with range `0–127` |
| `time_entity` | Yes | Time helper |
| `duration_entity` | Yes | Number helper used for watering duration |
| `enabled_entity` | No | Toggle helper used as master enable switch |
| `mode_entity` | No | Dropdown helper with `Manual` and `Auto` options |
| `weather_entity` | No | Weather entity displayed in Auto mode |
| `log_entity` | No | Gardena valve/switch whose history is used for the last 10 runs |
| `log_days` | No | Number of history days to search; default `90` |
| `active_states` | No | States treated as running; default `on`, `open`, `opening` |
| `title` | No | Card title |
| `icon` | No | Material Design icon |
| `language` | No | `el` or `en` |
| `duration_unit` | No | Custom duration unit label |

## Manual installation

Copy `dist/watering-scheduler-card.js` to `/config/www/watering-scheduler-card.js`, then add `/local/watering-scheduler-card.js` as a JavaScript module under **Settings → Dashboards → Resources**.

## License

MIT
