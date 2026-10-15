import { PageHead } from "../components/common"
import { Icon } from "../components/Icon"
import { ACHIEVEMENTS, formatDate } from "../lib/rules"
import type { AppData } from "../types"

/**
 * The Achievement gallery.
 *
 * Every badge is shown as unlocked. That is a deliberate product decision, not a
 * rendering default: the page never looks up a "locked" state, never renders a
 * lock icon and never prints an unlock requirement, so no badge can appear
 * locked after a refresh, a re-login or a data sync.
 *
 * Unlocking the gallery is presentation only. It writes no SP transaction and
 * fabricates no historical activity — the reward ledger stays exactly as it was,
 * which is why the "earned" timestamp below is shown only when the account
 * genuinely earned that badge.
 */
export function Achievements({ data }: { data: AppData }) {
  const earned = new Map(data.achievements.map((item) => [item.code, item.unlockedAt]))

  return (
    <>
      <PageHead
        eyebrow="YOUR MILESTONES"
        title="Achievements"
        text={`All ${ACHIEVEMENTS.length} badges are open on this account. The date shown is when the account genuinely earned it, when it did.`}
      />
      <div className="achievement-grid">
        {ACHIEVEMENTS.map((item) => {
          const unlockedAt = earned.get(item.code)
          const genuinelyEarned = Boolean(unlockedAt) && data.achievements.some(
            (entry) => entry.code === item.code,
          )
          return (
            <article className="card achievement-card unlocked" key={item.code}>
              <div className="achievement-icon">
                <Icon name={item.icon} />
              </div>
              <span className="eyebrow">UNLOCKED</span>
              <h2>{item.title}</h2>
              <p>{item.description}</p>
              <small>
                {genuinelyEarned && unlockedAt
                  ? `Earned ${formatDate(unlockedAt)} · +${item.xpReward} SP`
                  : `Worth +${item.xpReward} SP · no points are granted for unlocking`}
              </small>
            </article>
          )
        })}
      </div>
    </>
  )
}

export default Achievements
