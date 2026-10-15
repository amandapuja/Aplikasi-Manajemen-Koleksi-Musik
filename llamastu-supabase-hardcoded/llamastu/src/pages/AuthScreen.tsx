import { useRef, useState, type FormEvent, type KeyboardEvent } from "react"
import { Button, Logo, Mascot } from "../components/common"
import { Icon } from "../components/Icon"
import { signIn, signUp, signInDemo, type BackendStatus } from "../lib/api"

/**
 * Halaman Autentikasi Llamastu (Sign In & Sign Up).
 *
 * Terintegrasi penuh dengan Supabase Auth:
 * - Mendukung Sign In (email & password)
 * - Mendukung Create Account (Sign Up) dengan auto-konfirmasi & langsung login
 * - 1-Click Instant Demo yang terhubung ke cloud Supabase (tersinkronisasi lintas perangkat)
 * - Penanganan error yang ramah & intuitif dalam Bahasa Indonesia & Inggris
 */

type Mode = "signin" | "signup"
type Field = "name" | "email" | "password" | "confirm"
type FieldErrors = Partial<Record<Field, string>>

const MODES: Mode[] = ["signin", "signup"]
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Checks the form before anything is sent. */
function validate(mode: Mode, values: Record<Field, string>): FieldErrors {
  const errors: FieldErrors = {}
  const email = values.email.trim()

  if (!email) errors.email = "Masukkan alamat email Anda."
  else if (!EMAIL_PATTERN.test(email)) errors.email = "Format email tidak valid (contoh: kamu@kampus.ac.id)."

  if (!values.password) {
    errors.password = "Masukkan password Anda."
  } else if (mode === "signup" && values.password.length < 8) {
    errors.password = "Password minimal terdiri dari 8 karakter."
  }

  if (mode === "signup" && !values.name.trim()) {
    errors.name = "Masukkan nama lengkap atau nama panggilan Anda."
  }

  if (mode === "signup" && values.password && !errors.password && values.password !== values.confirm) {
    errors.confirm = "Konfirmasi password tidak cocok."
  }
  return errors
}

/** Turns backend wording into friendly and helpful messages. */
function friendlyError(raw: string): string {
  const text = raw.toLowerCase()
  if (text.includes("invalid login credentials")) return "Email atau password yang Anda masukkan salah. Silakan periksa kembali."
  if (text.includes("user already registered") || text.includes("already registered")) {
    return "Email ini sudah terdaftar. Silakan pilih tab 'Masuk' (Sign In)."
  }
  if (text.includes("password should be at least")) {
    return "Password terlalu pendek. Gunakan minimal 8 karakter."
  }
  if (text.includes("not confirmed")) {
    return "Email Anda belum terkonfirmasi. Silakan periksa inbox/spam email Anda."
  }
  if (text.includes("rate limit") || text.includes("too many")) {
    return "Terlalu banyak percobaan. Harap tunggu beberapa saat lalu coba lagi."
  }
  if (text.includes("cannot reach") || text.includes("fetch failed") || text.includes("network")) {
    return "Koneksi ke server gagal. Harap periksa koneksi internet Anda."
  }
  return raw
}

export function AuthScreen({
  onAuthenticated,
  backend,
}: {
  onAuthenticated: () => void
  backend: BackendStatus
}) {
  const [mode, setMode] = useState<Mode>("signin")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [name, setName] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [demoBusy, setDemoBusy] = useState(false)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const formRef = useRef<HTMLFormElement>(null)

  const working = busy || demoBusy

  function focusFirstInvalid() {
    window.requestAnimationFrame(() => {
      formRef.current?.querySelector<HTMLInputElement>('input[aria-invalid="true"]')?.focus()
    })
  }

  function clearFeedback() {
    setError("")
    setMessage("")
    setFieldErrors({})
  }

  /** Clears the error on a field as soon as the person edits it. */
  function edit(field: Field, setter: (value: string) => void, value: string) {
    setter(value)
    setError("")
    if (fieldErrors[field]) setFieldErrors((current) => ({ ...current, [field]: undefined }))
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (working) return
    clearFeedback()

    const problems = validate(mode, { name, email, password, confirm })
    if (Object.keys(problems).length > 0) {
      setFieldErrors(problems)
      focusFirstInvalid()
      return
    }

    setBusy(true)
    try {
      if (mode === "signin") {
        await signIn(email.trim(), password)
      } else {
        await signUp(email.trim(), password, name.trim())
      }
      onAuthenticated()
    } catch (reason) {
      const text = reason instanceof Error ? reason.message : "Autentikasi gagal."
      if (mode === "signup" && text.toLowerCase().includes("confirm")) {
        setMode("signin")
        setPassword("")
        setConfirm("")
        setMessage(text)
      } else {
        setError(friendlyError(text))
      }
    } finally {
      setBusy(false)
    }
  }

  async function handleDemoLogin() {
    if (working) return
    clearFeedback()
    setDemoBusy(true)
    try {
      await signInDemo()
      onAuthenticated()
    } catch (reason) {
      const text = reason instanceof Error ? reason.message : "Gagal masuk ke akun demo."
      setError(friendlyError(text))
    } finally {
      setDemoBusy(false)
    }
  }

  function switchMode(next: Mode, focusForm = true) {
    if (next === mode) return
    setMode(next)
    setPassword("")
    setConfirm("")
    setShowPassword(false)
    clearFeedback()
    if (focusForm) {
      window.requestAnimationFrame(() => formRef.current?.querySelector("input")?.focus())
    }
  }

  /** Arrow keys, Home and End move between the two tabs. */
  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const index = MODES.indexOf(mode)
    let next: Mode | null = null
    if (event.key === "ArrowRight") next = MODES[(index + 1) % MODES.length]
    else if (event.key === "ArrowLeft") next = MODES[(index - 1 + MODES.length) % MODES.length]
    else if (event.key === "Home") next = MODES[0]
    else if (event.key === "End") next = MODES[MODES.length - 1]
    if (!next) return
    event.preventDefault()
    switchMode(next, false)
    window.requestAnimationFrame(() => document.getElementById(`auth-tab-${next}`)?.focus())
  }

  const signingIn = mode === "signin"

  return (
    <main className="auth-page">
      <section className="auth-story">
        <Logo />
        <div className="auth-story-copy">
          <span className="welcome-kicker">INTERACTIVE LEARNING PLATFORM</span>
          <h1>
            Bawa Materimu.
            <br />
            Kami Bangun Dunianya.
          </h1>
          <p>
            Unggah dokumen kuliah atau catatan Anda. Llamastu secara instan menyusun rangkuman,
            flashcard, kuis, dan dunia platformer interaktif untuk menguji pemahaman Anda.
          </p>
        </div>
        <div className="auth-mascot">
          <Mascot pose="folder" />
        </div>
      </section>

      <section className="auth-panel">
        <form ref={formRef} className="auth-form" onSubmit={submit} noValidate>
          <Logo />

          <div className="auth-tabs" role="tablist" aria-label="Akun">
            {MODES.map((item) => (
              <button
                key={item}
                id={`auth-tab-${item}`}
                type="button"
                role="tab"
                aria-selected={mode === item}
                aria-controls="auth-fields"
                tabIndex={mode === item ? 0 : -1}
                className={mode === item ? "active" : ""}
                onClick={() => switchMode(item)}
                onKeyDown={onTabKeyDown}
              >
                {item === "signin" ? "Masuk (Sign in)" : "Daftar (Create account)"}
              </button>
            ))}
          </div>

          {backend.mode === "local" || !backend.supabaseAvailable ? (
            <div className="form-alert error" role="status">
              {backend.mode === "local"
                ? backend.detail
                : "Sinkronisasi cloud sedang tidak tersedia. Data lokal tetap aman di browser ini."}
              {backend.reason ? ` ${backend.reason}` : ""}
            </div>
          ) : null}

          <div id="auth-fields" role="tabpanel" aria-labelledby={`auth-tab-${mode}`}>
            <h2>{signingIn ? "Selamat Datang Kembali" : "Mulai Petualangan Belajarmu"}</h2>
            <p>
              {signingIn
                ? "Masuk ke akun Anda untuk mengakses materi, catatan, jadwal, dan progres yang tersimpan."
                : "Buat akun baru. Data Anda tersimpan aman di cloud dan dapat diakses dari perangkat manapun."}
            </p>

            {!signingIn && (
              <div className="auth-field">
                <label htmlFor="auth-name">Nama Lengkap / Panggilan</label>
                <input
                  id="auth-name"
                  name="name"
                  type="text"
                  autoComplete="name"
                  value={name}
                  onChange={(event) => edit("name", setName, event.target.value)}
                  placeholder="Nama yang akan ditampilkan di profil"
                  aria-invalid={fieldErrors.name ? true : undefined}
                  aria-describedby={fieldErrors.name ? "auth-name-error" : undefined}
                  disabled={working}
                />
                {fieldErrors.name && (
                  <span id="auth-name-error" className="field-error">
                    {fieldErrors.name}
                  </span>
                )}
              </div>
            )}

            <div className="auth-field">
              <label htmlFor="auth-email">Alamat Email</label>
              <input
                id="auth-email"
                name="email"
                type="email"
                inputMode="email"
                autoComplete={signingIn ? "username" : "email"}
                autoCapitalize="none"
                spellCheck={false}
                value={email}
                onChange={(event) => edit("email", setEmail, event.target.value)}
                placeholder="nama@kampus.ac.id atau email@gmail.com"
                aria-invalid={fieldErrors.email ? true : undefined}
                aria-describedby={fieldErrors.email ? "auth-email-error" : undefined}
                disabled={working}
              />
              {fieldErrors.email && (
                <span id="auth-email-error" className="field-error">
                  {fieldErrors.email}
                </span>
              )}
            </div>

            <div className="auth-field">
              <label htmlFor="auth-password">Password</label>
              <div className="password-field">
                <input
                  id="auth-password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete={signingIn ? "current-password" : "new-password"}
                  value={password}
                  onChange={(event) => edit("password", setPassword, event.target.value)}
                  placeholder={signingIn ? "Masukkan password Anda" : "Minimal 8 karakter"}
                  aria-invalid={fieldErrors.password ? true : undefined}
                  aria-describedby={
                    fieldErrors.password
                      ? "auth-password-error"
                      : !signingIn
                        ? "auth-password-hint"
                        : undefined
                  }
                  disabled={working}
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword((current) => !current)}
                  aria-pressed={showPassword}
                  aria-label={showPassword ? "Sembunyikan password" : "Tampilkan password"}
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
              {fieldErrors.password ? (
                <span id="auth-password-error" className="field-error">
                  {fieldErrors.password}
                </span>
              ) : (
                !signingIn && (
                  <span id="auth-password-hint" className="field-hint">
                    Gunakan minimal 8 karakter.
                  </span>
                )
              )}
            </div>

            {!signingIn && (
              <div className="auth-field">
                <label htmlFor="auth-confirm">Konfirmasi Password</label>
                <input
                  id="auth-confirm"
                  name="confirm"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(event) => edit("confirm", setConfirm, event.target.value)}
                  placeholder="Ulangi password Anda"
                  aria-invalid={fieldErrors.confirm ? true : undefined}
                  aria-describedby={fieldErrors.confirm ? "auth-confirm-error" : undefined}
                  disabled={working}
                />
                {fieldErrors.confirm && (
                  <span id="auth-confirm-error" className="field-error">
                    {fieldErrors.confirm}
                  </span>
                )}
              </div>
            )}

            {error && (
              <div className="form-alert error" role="alert">
                <Icon name="close" size={15} />
                <span>{error}</span>
              </div>
            )}
            {message && (
              <div className="form-alert success" role="status">
                <Icon name="check" size={15} />
                <span>{message}</span>
              </div>
            )}

            <Button type="submit" className="full" disabled={working}>
              {busy ? (
                <>
                  <span className="button-spinner" />
                  <span>{signingIn ? "Sedang masuk…" : "Membuat akun…"}</span>
                </>
              ) : (
                <span>{signingIn ? "Masuk ke Akun" : "Daftar Sekarang"}</span>
              )}
            </Button>
          </div>

          <div className="auth-demo">
            <div className="auth-divider">
              <span>atau coba tanpa registrasi</span>
            </div>

            <button
              type="button"
              className="demo-login-btn"
              onClick={handleDemoLogin}
              disabled={working}
              style={{
                width: "100%",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                marginTop: "12px",
                padding: "12px 18px",
                borderRadius: "14px",
                border: "1.5px solid rgba(224, 122, 95, 0.35)",
                background: "linear-gradient(135deg, rgba(224, 122, 95, 0.12), rgba(244, 241, 222, 0.05))",
                color: "inherit",
                fontSize: "14px",
                fontWeight: 600,
                cursor: working ? "not-allowed" : "pointer",
                transition: "all 0.2s ease",
              }}
            >
              {demoBusy ? (
                <>
                  <span className="button-spinner" />
                  <span>Membuka akun demo Supabase…</span>
                </>
              ) : (
                <>
                  <Icon name="spark" />
                  <span>Jelajahi dengan Akun Demo (1-Klik)</span>
                </>
              )}
            </button>

            <p className="auth-demo-note" style={{ marginTop: "10px", fontSize: "12px", opacity: 0.8, textAlign: "center", lineHeight: "1.5" }}>
              🚀 <strong>Tersinkronisasi Cloud:</strong> Akun demo memiliki materi & jadwal bawaan di database Supabase yang tidak hilang saat berpindah perangkat atau berganti browser.
            </p>
          </div>
        </form>
      </section>
    </main>
  )
}

export default AuthScreen
