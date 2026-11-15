// static/js/core/login.js
// Login page.
// Plain script (no modules): functions stay global because the HTML uses inline onclick="..." handlers.
// Shared helpers: core/api.js, core/ui.js, core/sidebar.js. Split out of the former static/app.js.

// ---------- Login Page ----------
function initLoginPage() {
  const form = document.getElementById("loginForm");
  if (!form) return;

  const identifierEl = document.getElementById("identifier");
  const passwordEl = document.getElementById("password");
  const identifierMsg = document.getElementById("identifierMsg");
  const passwordMsg = document.getElementById("passwordMsg");
  const errorEl = document.getElementById("error");

  identifierEl.addEventListener("input", () => {
    identifierMsg.textContent = "";
    identifierEl.classList.remove("field-error");
    errorEl.textContent = "";
  });
  passwordEl.addEventListener("input", () => {
    passwordMsg.textContent = "";
    passwordEl.classList.remove("field-error");
    errorEl.textContent = "";
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    identifierMsg.textContent = "";
    passwordMsg.textContent = "";
    errorEl.textContent = "";
    identifierEl.classList.remove("field-error");
    passwordEl.classList.remove("field-error");

    const identifier = identifierEl.value.trim();
    const password = passwordEl.value;

    let hasError = false;

    if (!identifier) {
      identifierMsg.textContent = "Please enter your email, Student ID or Employee ID.";
      identifierEl.classList.add("field-error");
      hasError = true;
    }

    if (!password) {
      passwordMsg.textContent = "Please enter your password.";
      passwordEl.classList.add("field-error");
      hasError = true;
    } else if (password.length < 6) {
      passwordMsg.textContent = "Password must be at least 6 characters.";
      passwordEl.classList.add("field-error");
      hasError = true;
    }

    if (hasError) return;

    try {
      const res = await apiFetch(API + "/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier, password }),
      });
      const data = await res.json();

      if (!res.ok) {
        errorEl.textContent = data.detail || "Invalid email or password";
        return;
      }

      saveToken(data.access_token, data.user);
      window.location.href = "/dashboard.html";
    } catch (e) {
      errorEl.textContent = "Network error. Please try again.";
    }
  });
}

document.addEventListener("DOMContentLoaded", initLoginPage);
