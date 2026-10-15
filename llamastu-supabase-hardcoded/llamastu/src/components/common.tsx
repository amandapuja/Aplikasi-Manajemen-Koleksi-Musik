import type { ReactNode } from "react"
import type { Character, IconName } from "../types"
import { Icon } from "./Icon"

export function Logo() {
  return (
    <div className="logo">
      <div className="logo-mark">
        <span />
      </div>
      <div>
        <strong>Llamastu</strong>
        <small>YOUR COZY STUDY WORLD</small>
      </div>
    </div>
  )
}

export function Mascot({
  pose = "reading",
}: {
  pose?: "reading" | "folder" | "celebrate" | "study"
}) {
  const prop: IconName =
    pose === "folder" ? "folder" : pose === "celebrate" ? "award" : "book"
  return (
    <div
      className={`llama-mascot mascot-${pose}`}
      role="img"
      aria-label="Llamastu study buddy mascot"
    >
      <div className="llama-ears">
        <i />
        <i />
      </div>
      <div className="llama-head">
        <div className="llama-fringe" />
        <div className="llama-eyes">
          <i />
          <i />
        </div>
        <div className="llama-muzzle">
          <span />
        </div>
      </div>
      <div className="llama-body">
        <div className="llama-spots" />
      </div>
      <div className="llama-prop">
        <Icon name={prop} />
      </div>
      <div className="llama-feet">
        <i />
        <i />
      </div>
    </div>
  )
}

export function Button({
  children,
  variant = "primary",
  icon,
  onClick,
  type = "button",
  disabled = false,
  className = "",
  ariaLabel,
}: {
  children: ReactNode
  variant?: "primary" | "secondary" | "ghost" | "dark" | "danger"
  icon?: IconName
  onClick?: () => void
  type?: "button" | "submit"
  disabled?: boolean
  className?: string
  ariaLabel?: string
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      className={`btn btn-${variant} ${className}`}
      onClick={onClick}
      aria-label={ariaLabel}
    >
      {icon && <Icon name={icon} size={17} />}
      {children}
    </button>
  )
}

export function Progress({ value, label }: { value: number; label?: string }) {
  const safe = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0))
  return (
    <div
      className="progress"
      role="progressbar"
      aria-valuenow={Math.round(safe)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label ?? `${Math.round(safe)}% complete`}
    >
      <span style={{ width: `${safe}%` }} />
    </div>
  )
}

export function Avatar({
  character,
  large = false,
  scale,
}: {
  character?: Partial<Character>
  large?: boolean
  scale?: number
}) {
  const outfit = character?.outfit || "peach"
  const hair = character?.hair || "cocoa"
  const hat = character?.hat || "none"
  const backpack = character?.backpack || "canvas"
  const accessory = character?.accessory || "book"
  const face = character?.face || "bright"
  const shoes = character?.shoes || "trail"
  const glasses = character?.glasses || "none"
  return (
    <div
      className={`avatar ${large ? "avatar-large" : ""} avatar-model-${character?.model ?? "male"} outfit-${outfit} hair-${hair} hat-${hat} backpack-${backpack} accessory-${accessory} face-${face} shoes-${shoes} glasses-${glasses}`}
      style={scale ? { transform: `scale(${scale})`, transformOrigin: "center bottom" } : undefined}
      role="img"
      aria-label={`Character avatar wearing a ${outfit} outfit with ${hair} hair`}
    >
      {hat !== "none" && <div className="avatar-hat" />}
      <div className="avatar-hair" />
      <div className="avatar-face">
        <i />
        <b />
        <span />
      </div>
      <div className="avatar-body">
        <span />
      </div>
      <div className="avatar-shoes" />
      <div className="avatar-backpack" />
      {glasses !== "none" && <div className="avatar-glasses" />}
      <div className="avatar-accessory" />
    </div>
  )
}

export function Empty({
  icon,
  title,
  text,
  action,
}: {
  icon: IconName
  title: string
  text: string
  action?: ReactNode
}) {
  return (
    <div className="empty-state">
      <div className="empty-mascot">
        <Mascot pose="study" />
      </div>
      <div className="empty-icon">
        <Icon name={icon} />
      </div>
      <h2>{title}</h2>
      <p>{text}</p>
      {action}
    </div>
  )
}

export function PageHead({
  eyebrow,
  title,
  text,
  action,
}: {
  eyebrow: string
  title: string
  text: string
  action?: ReactNode
}) {
  return (
    <div className="page-head">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{text}</p>
      </div>
      {action}
    </div>
  )
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="error-note" role="alert">
      <Icon name="close" size={16} />
      <span>{message}</span>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  )
}
