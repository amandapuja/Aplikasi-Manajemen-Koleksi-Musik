/**
 * Demo account.
 *
 * This is a REAL account, not a fake login: it has a normal password hash, a
 * real session, and its own rows in the database. What makes it a "demo" is
 * that it is seeded with finished learning data (processed materials, real
 * generated summaries, flashcards and questions, calendar entries with
 * reminders, notes and world progress) so the whole product can be explored
 * immediately without uploading anything first.
 *
 * These credentials are intentionally published in the UI and the README. They
 * are not a secret, and the account holds no real user data. Everything inside
 * it is written by the same code paths a normal account uses, so nothing in the
 * demo is a mock-up.
 */

export const DEMO_EMAIL = "demo@llamastu.app"
export const DEMO_PASSWORD = "DemoPass123!"
export const DEMO_NAME = "Demo Learner"

/**
 * The demo entry path is a name, not a credential — but it is not a bypass.
 *
 * The demo identity below is fixed and separate from every real account, so the
 * demo workspace isolates its own data and can never write into a real user's
 * rows. Real sign-in and registration go through the ordinary provider; this
 * constant only names the demo identity.
 */

/** Fixed identity for the demo workspace, so demo data stays isolated. */
export const DEMO_USER_ID = "demo-user"

/** Where the demo identity is remembered between visits. */
export const DEMO_SESSION_KEY = "llamastu.demo.user"

export type DemoUser = {
  id: string
  name: string
  email: string
  mode: "demo"
}

/** "alifah binti" / "ALIFAH" / "alifah@example.com" all read as "Alifah". */
function displayNameFrom(value: string): string {
  return value
    .replace(/[._-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ")
    .slice(0, 60)
}

/**
 * Turns whatever someone types into the demo identity. A plain name is accepted,
 * an email address is accepted, and neither is verified against anything.
 */
export function demoIdentityFrom(input: string): DemoUser {
  const trimmed = input.trim()
  const looksLikeEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)
  const local = looksLikeEmail ? trimmed.split("@")[0] : trimmed
  const name = displayNameFrom(local) || "Demo Learner"
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "")
  const email = looksLikeEmail
    ? trimmed.toLowerCase()
    : `${slug || "demo.user"}@example.com`
  return { id: DEMO_USER_ID, name, email, mode: "demo" }
}

/** The remembered demo identity, used to prefill the name field. */
export function readDemoUser(): DemoUser | null {
  try {
    if (typeof localStorage === "undefined") return null
    const raw = localStorage.getItem(DEMO_SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<DemoUser>
    if (typeof parsed?.name !== "string" || !parsed.name.trim()) return null
    return {
      id: DEMO_USER_ID,
      name: parsed.name,
      email: typeof parsed.email === "string" ? parsed.email : "",
      mode: "demo",
    }
  } catch {
    return null
  }
}

export type DemoSeedMaterial = {
  name: string
  title: string
  subject: string
  text: string
}

/** Two finished courses, so the library, quiz and worlds all have real content. */
export const DEMO_MATERIALS: DemoSeedMaterial[] = [
  {
    name: "Slide 06 - Multi Linked List (MLL).txt",
    title: "Slide 06 - Multi Linked List (MLL)",
    subject: "Data Structures",
    text: `A multi linked list is a linked data structure in which each node may contain more than one pointer field, so a single set of nodes can participate in several independent linear orderings at the same time. A single linked list node stores one pointer, whereas a multi linked list node stores a separate pointer for every list that the node belongs to. This makes multi linked lists the natural representation for sparse matrices, for polynomial arithmetic with several variables, and for database indexes that must be traversed in more than one order.
Each node in a multi linked list typically carries a data field plus one pointer per dimension. In a two dimensional multi linked list the node holds a next column pointer and a next row pointer. A header node is a sentinel node that carries no data and exists only to mark the beginning of a row or a column. Sentinel nodes remove the special cases that would otherwise be needed for the first and last element of every list.
Insertion into a multi linked list requires the new node to be linked into every list it belongs to. If the node belongs to two lists, insertion updates two sets of pointers. Forgetting to update one of the lists produces a node that is reachable through one traversal and invisible through the other, which is a common source of subtle bugs.
Traversal of a multi linked list follows one pointer field at a time. Advancing along the row pointers visits the elements in row major order, while advancing along the column pointers visits the elements in column major order. Because the two orders share the same nodes, an update made through the row traversal is immediately visible through the column traversal.
Deletion from a multi linked list must unlink the node from every list it belongs to before the node is released. If the node is freed while one list still points to it, that list becomes a dangling reference. Garbage collected languages reduce the risk of a dangling reference but they cannot repair a logically inconsistent set of pointers, so explicit unlinking remains necessary.
The memory cost of a multi linked list is higher than that of a single linked list because every node carries several pointers. The advantage is that no duplicate copies of the data are required. A sparse matrix represented as a multi linked list stores only the non zero entries, together with their row and column links, instead of storing every cell of the matrix.
Orthogonal linked lists are the most common form of multi linked list. In an orthogonal linked list every row and every column has its own header node, and each data node is linked into exactly one row list and exactly one column list. This structure is used by sparse matrix libraries because row traversal and column traversal are both efficient.
The time complexity of inserting a node into a multi linked list is constant once the position in each list is known, because only the neighbouring pointers must be rewritten. Searching a multi linked list is linear in the length of the list that is traversed, so the structure is not a substitute for a balanced search tree when fast lookup by key is the primary requirement.`,
  },
  {
    name: "Week 04 - Database Normalisation.txt",
    title: "Week 04 - Database Normalisation",
    subject: "Databases",
    text: `Database normalisation is the process of organising the columns and tables of a relational database to minimise data redundancy and prevent update anomalies. First normal form requires that every column contains only atomic values and that each record is unique. Second normal form removes partial dependencies, which means every non key attribute must depend on the whole primary key. Third normal form eliminates transitive dependencies so that non key attributes depend only on the primary key.
Boyce Codd normal form is a stronger version of third normal form that handles certain anomalies involving overlapping candidate keys. Denormalisation is the deliberate introduction of redundancy to improve read performance. An index is a data structure that speeds up the retrieval of rows from a table.
A transaction is a unit of work that is executed atomically so the database never observes a partially applied change. Atomicity means that a transaction either completes entirely or not at all. Isolation controls how concurrent transactions observe each other's intermediate states. Durability guarantees that committed data survives a system failure.
A primary key uniquely identifies each row in a relation while a foreign key references a primary key in another table. Referential integrity ensures that a foreign key always points at an existing row. A join combines rows from two relations using a related column. Cardinality describes how many rows participate on each side of a relationship.
Concurrency control prevents two writers from corrupting the same page at the same time. The write ahead log records changes before they are applied so recovery can replay them. A checkpoint flushes dirty pages so that recovery can start from a known consistent state. Sharding partitions a large relation across several physical machines.`,
  },
]
