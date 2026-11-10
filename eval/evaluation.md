# ============================================================
# ShadowForge — Evaluation Scripts
# Tests for the three official hackathon tasks.
# ============================================================

## TASK A — Inline Edit

### Setup

```bash
# Clone Flask at the required commit
git clone https://github.com/pallets/flask flask-eval
cd flask-eval
git checkout 22d924701a6ae2e4cd01e9a15bbaf3946094af65
```

### Manual Test Steps

1. Open the `flask-eval` folder in VS Code with ShadowForge installed.
2. Open `src/flask/helpers.py`.
3. Select the `get_debug_flag` function (lines ~20-50).
4. Press `Ctrl+K`.
5. Enter: `Treat the values 'off' and 'n' as false as well, case-insensitively, and update the docstring to list every value that is treated as false.`
6. Review the diff in the VS Code diff editor.
7. Accept the changes.

### Verification

```bash
cd flask-eval
FLASK_DEBUG=off python -c "from flask.helpers import get_debug_flag; print(get_debug_flag())"
```

**Expected output:** `False`

---

## TASK B — Agent Mode

### Manual Test Steps

1. Ensure Flask is open in VS Code.
2. Open ShadowForge Chat panel.
3. Send this exact message:
   ```
   Add a new built-in CLI command flask config that prints the loaded application's configuration as JSON, masking the values of any key containing SECRET, PASSWORD, TOKEN or KEY as "***". It must appear in flask --help, be covered by a test, and be documented alongside the other built-in commands. Review the hunks and accept.
   ```
4. Watch the agent discover `src/flask/cli.py`, `tests/test_cli.py`, and `docs/cli.rst`.
5. Review the Context Ledger to see file selection reasoning.
6. Review proposed hunks and accept.

### Verification

```bash
cd flask-eval
pytest tests/test_cli.py -q
```

**Expected:** All tests pass, including the new `test_config_command`.

```bash
cd flask-eval
# Create a test app
python -c "
from flask import Flask
app = Flask(__name__)
app.config['SECRET_KEY'] = 'mysecret'
app.config['DATABASE_URL'] = 'sqlite:///db.db'
with app.app_context():
    import subprocess
    result = subprocess.run(['flask', 'config'], capture_output=True, text=True)
    print(result.stdout)
"
```

**Expected output:** JSON with `SECRET_KEY: "***"` and `DATABASE_URL: "sqlite:///db.db"`.

---

## TASK C — Resilience

### Setup

Configure TrueForge with an invalid API key OR point to an unreachable URL.

VS Code settings (`settings.json`):
```json
{
  "shadowforge.trueforgeUrl": "http://localhost:9999",
  "shadowforge.trueforgeApiKey": "invalid-key-for-testing"
}
```

### Manual Test Steps

1. Apply the bad configuration above.
2. Open ShadowForge Chat.
3. Repeat Task A (Ctrl+K on `get_debug_flag`).
4. The model health indicator should turn yellow/red.
5. If a fallback agent is configured correctly, it should auto-switch.
6. No files should be modified.

### Verification

```bash
cd flask-eval
git status
```

**Expected output:** `nothing to commit, working tree clean`
