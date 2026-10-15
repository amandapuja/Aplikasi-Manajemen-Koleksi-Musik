import { useRef, useState } from "react"
import { Avatar } from "../components/common"
import { Icon } from "../components/Icon"
import { api } from "../lib/api"
import { CHARACTER_OPTIONS, DEFAULT_CHARACTER } from "../lib/rules"
import type { AppData, Character } from "../types"

type Category = {
  key: keyof Character
  label: string
}

const CATEGORIES: Category[] = [
  { key: "model", label: "Body" },
  { key: "hair", label: "Hair" },
  { key: "face", label: "Expression" },
  { key: "outfit", label: "Outfit" },
  { key: "shoes", label: "Shoes" },
  { key: "hat", label: "Hat" },
  { key: "glasses", label: "Glasses" },
  { key: "backpack", label: "Backpack" },
  { key: "accessory", label: "Accessory" },
]

export function CharactersPage({
  data,
  refresh,
  toast,
}: {
  data: AppData
  refresh: () => Promise<void>
  toast: (message: string, error?: boolean) => void
}) {
  const [activeCategory, setActiveCategory] = useState<keyof Character>("outfit")
  const [saving, setSaving] = useState(false)
  const tabsScrollRef = useRef<HTMLDivElement>(null)

  const currentCharacter: Character = {
    ...DEFAULT_CHARACTER,
    ...(data.progress.character ?? {}),
  }

  // Local optimistic state for immediate visual feedback
  const [previewCharacter, setPreviewCharacter] = useState<Character>(currentCharacter)

  // Keep preview character in sync when data updates
  const effectiveCharacter = saving ? previewCharacter : currentCharacter

  const options = CHARACTER_OPTIONS[activeCategory] ?? []

  function scrollTabs(direction: "left" | "right") {
    if (!tabsScrollRef.current) return
    const offset = direction === "left" ? -120 : 120
    tabsScrollRef.current.scrollBy({ left: offset, behavior: "smooth" })
  }

  async function handleEquip(key: keyof Character, value: string) {
    if (effectiveCharacter[key] === value) return

    const nextCharacter: Character = {
      ...effectiveCharacter,
      [key]: value,
    }

    setPreviewCharacter(nextCharacter)
    setSaving(true)

    try {
      await api("/character", {
        method: "PATCH",
        body: JSON.stringify({ [key]: value }),
      })
      await refresh()
      toast(`Equipped ${value}`)
    } catch {
      setPreviewCharacter(currentCharacter)
      toast("Could not save character change. Please try again.", true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="characters-page-layout">
      {/* Left Column: Character Stage with Pedestal & Ambient Glow */}
      <section className="character-stage-card" aria-label="Character Preview Stage">
        <div className="character-stage-pedestal" />
        <div className="character-stage-avatar">
          <Avatar character={effectiveCharacter} scale={3.3} />
        </div>
      </section>

      {/* Right Column: Wardrobe Customizer */}
      <section className="character-wardrobe-card" aria-label="Wardrobe Customizer">
        <div>
          {/* Top category navigation tabs */}
          <div className="wardrobe-tabs-bar">
            <button
              type="button"
              className="wardrobe-tab-arrow"
              onClick={() => scrollTabs("left")}
              aria-label="Scroll categories left"
            >
              <Icon name="chevron-left" size={14} />
            </button>

            <div className="wardrobe-tabs-scroll" ref={tabsScrollRef}>
              {CATEGORIES.map((cat) => {
                const isActive = activeCategory === cat.key
                return (
                  <button
                    key={cat.key}
                    type="button"
                    className={`wardrobe-tab-btn ${isActive ? "active" : ""}`}
                    onClick={() => setActiveCategory(cat.key)}
                  >
                    {cat.label}
                  </button>
                )
              })}
            </div>

            <button
              type="button"
              className="wardrobe-tab-arrow"
              onClick={() => scrollTabs("right")}
              aria-label="Scroll categories right"
            >
              <Icon name="chevron-right" size={14} />
            </button>
          </div>

          {/* Wardrobe options grid */}
          <div className="wardrobe-options-grid">
            {options.map((opt) => {
              const isEquipped = effectiveCharacter[activeCategory] === opt
              const cardPreview: Character = {
                ...effectiveCharacter,
                [activeCategory]: opt,
              }

              return (
                <button
                  key={opt}
                  type="button"
                  className={`wardrobe-option-card ${isEquipped ? "equipped" : ""}`}
                  onClick={() => handleEquip(activeCategory, opt)}
                  disabled={saving}
                >
                  <span className="wardrobe-option-tag">{opt}</span>

                  <div className="wardrobe-preview-center">
                    <Avatar character={cardPreview} scale={1.5} />
                  </div>

                  <div className={`wardrobe-status-text ${isEquipped ? "equipped" : ""}`}>
                    {isEquipped ? (
                      <>
                        <Icon name="check" size={13} />
                        <span>Equipped</span>
                      </>
                    ) : (
                      <span>Equip</span>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* Bottom unlocked through learning banner */}
        <div className="wardrobe-info-banner">
          <Icon name="award" size={24} />
          <div>
            <b>Unlocked through learning</b>
            <small>Llamastu has no paid or premium items.</small>
          </div>
        </div>
      </section>
    </div>
  )
}
export default CharactersPage
