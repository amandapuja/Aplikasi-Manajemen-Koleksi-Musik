import { Button, Empty, Mascot, Progress } from "../components/common"
import { Icon } from "../components/Icon"
import {
  ACHIEVEMENTS,
  ACHIEVEMENT_BY_CODE,
  formatDate,
  materialProgress,
  xpIntoLevel,
  XP_PER_LEVEL,
} from "../lib/rules"
import type { AppData, Material, Page } from "../types"

export function Dashboard({
  data,
  go,
  openMaterial,
}: {
  data: AppData
  go: (page: Page) => void
  openMaterial: (material: Material) => void
}) {
  const ready = data.materials.filter((item) => item.status === "ready")
  const now = Date.now()
  const upcoming = data.schedules
    .filter((item) => new Date(item.endAt).getTime() > now)
    .sort((left, right) => left.startAt.localeCompare(right.startAt))
  const nextClass = upcoming[0]
  const xpInLevel = xpIntoLevel(data.progress.xp)
  const unlocked = data.achievements
    .map((item) => ACHIEVEMENT_BY_CODE[item.code])
    .filter(Boolean)
  const recentActivity = data.notifications.slice(0, 4)

  return (
    <>
      <section className="welcome">
        <div>
          <span className="date">
            {new Intl.DateTimeFormat("en-GB", {
              weekday: "long",
              month: "long",
              day: "numeric",
            })
              .format(new Date())
              .toUpperCase()}
          </span>
          <h1>
            Welcome, <span>{data.profile.name || "Learner"}</span>
          </h1>
          <p>Every material you bring creates a new path to explore.</p>
        </div>
        <div className="level-summary">
          <div className="level-badge">{data.progress.level}</div>
          <div>
            <span>LEVEL {data.progress.level}</span>
            <Progress
              value={(xpInLevel / XP_PER_LEVEL) * 100}
              label={`${xpInLevel} of ${XP_PER_LEVEL} XP`}
            />
            <small>
              {xpInLevel} / {XP_PER_LEVEL} XP to level {data.progress.level + 1}
            </small>
          </div>
          <div className="streak">
            <Icon name="flame" />
            <b>{data.progress.streak}</b>
            <span>day streak</span>
          </div>
        </div>
      </section>

      <div className="stats-grid">
        <div className="card stat-card">
          <div className="stat-icon peach">
            <Icon name="folder" />
          </div>
          <div>
            <strong>{data.materials.length}</strong>
            <span>Materials</span>
          </div>
        </div>
        <div className="card stat-card">
          <div className="stat-icon orange">
            <Icon name="quiz" />
          </div>
          <div>
            <strong>{data.progress.quizAttempts}</strong>
            <span>Quiz attempts</span>
          </div>
        </div>
        <div className="card stat-card">
          <div className="stat-icon blue">
            <Icon name="edit" />
          </div>
          <div>
            <strong>{data.notes.length}</strong>
            <span>Notes</span>
          </div>
        </div>
        <div className="card stat-card">
          <div className="stat-icon cyan">
            <Icon name="spark" />
          </div>
          <div>
            <strong>{data.progress.xp}</strong>
            <span>Total XP</span>
          </div>
        </div>
      </div>

      <div className="real-dashboard-grid">
        <section className="card home-feature">
          <div className="section-head">
            <div>
              <span className="eyebrow">CONTINUE LEARNING</span>
              <h2>Your learning worlds</h2>
            </div>
            <button onClick={() => go("materials")}>
              View all <Icon name="arrow" size={14} />
            </button>
          </div>
          {ready.length === 0 ? (
            <Empty
              icon="upload"
              title="Your first world starts with a file"
              text="Upload a real course document and Llamastu will extract it, summarise it, and build grounded challenges."
              action={
                <Button icon="upload" onClick={() => go("materials")}>
                  Upload material
                </Button>
              }
            />
          ) : (
            <div className="home-materials">
              {ready.slice(0, 3).map((material) => {
                const game = data.games[material.id]
                const cleared = game?.openedGates.length ?? 0
                return (
                  <button key={material.id} onClick={() => openMaterial(material)}>
                    <div className="material-cover">
                      <Icon name="book" />
                      <span>
                        {material.type.includes("pdf")
                          ? "PDF"
                          : material.type.startsWith("image")
                            ? "IMAGE"
                            : "DOC"}
                      </span>
                    </div>
                    <div>
                      <small>{material.subject || "LEARNING MATERIAL"}</small>
                      <b>{material.title || material.name}</b>
                      <span>
                        {cleared}/{material.questions.length} gates ·{" "}
                        {materialProgress(data, material.id)}% explored
                      </span>
                      <Progress value={materialProgress(data, material.id)} />
                    </div>
                    <Icon name="arrow" />
                  </button>
                )
              })}
            </div>
          )}
        </section>

        <aside className="dashboard-side">
          <section className="card next-class">
            <span className="eyebrow">UP NEXT</span>
            {nextClass ? (
              <>
                <h2>{nextClass.course}</h2>
                <p>{formatDate(nextClass.startAt)}</p>
                <span>
                  <Icon name="clock" size={15} /> {nextClass.room || "Room not set"}
                </span>
                <small>
                  {upcoming.length} upcoming {upcoming.length === 1 ? "class" : "classes"} saved
                </small>
              </>
            ) : (
              <Empty
                icon="calendar"
                title="No upcoming class"
                text="Add your university schedule and Llamastu will remind you while the app is open."
                action={
                  <Button variant="secondary" onClick={() => go("schedule")}>
                    Add schedule
                  </Button>
                }
              />
            )}
          </section>

          <section className="card activity-card">
            <div className="section-head">
              <div>
                <span className="eyebrow">RECENT ACTIVITY</span>
                <h2>What you just did</h2>
              </div>
            </div>
            {recentActivity.length === 0 ? (
              <p className="muted">Nothing yet. Your uploads, quizzes and gates appear here.</p>
            ) : (
              <ul className="activity-list">
                {recentActivity.map((item) => (
                  <li key={item.id}>
                    <i />
                    <div>
                      {/* Title and timestamp on one line: the timestamp used to
                          end up alone under the description with a ragged gap
                          beside it. */}
                      <div className="activity-row">
                        <b>{item.title}</b>
                        <small>{formatDate(item.createdAt)}</small>
                      </div>
                      <span>{item.message}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card achievement-strip">
            {/* Kept in step with the Achievements page: every badge is open, and
                this summary shows the same set rather than a different subset.
                The header now matches the Recent Activity card above it, and the
                link to the gallery lives on the badges card rather than being
                duplicated in the activity header. */}
            <div className="section-head">
              <div>
                <span className="eyebrow">BADGES EARNED</span>
                <p className="muted small">
                  All {ACHIEVEMENTS.length} badges are open on this account.
                </p>
              </div>
              <button onClick={() => go("achievements")}>
                View all <Icon name="arrow" size={14} />
              </button>
            </div>
            <div className="badge-row">
              {unlocked.map((item) => (
                <span key={item.code} className="badge-chip" title={item.description}>
                  <Icon name={item.icon} size={15} />
                  <span>{item.title}</span>
                </span>
              ))}
            </div>
          </section>

          <section className="daily-card card">
            <div className="challenge-art">
              <Mascot pose="celebrate" />
            </div>
            <span className="eyebrow light">CURRENT PROGRESS</span>
            <h2>{data.progress.completedChallenges} gates opened</h2>
            <p>
              {ready.length === 0
                ? "Challenges only appear after a real material has been processed."
                : "Answer a gate question in the adventure world to open the next section."}
            </p>
            <Button variant="secondary" onClick={() => go("materials")}>
              Choose a world
            </Button>
          </section>
        </aside>
      </div>
    </>
  )
}

export default Dashboard
