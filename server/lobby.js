import { normalizeBattleSpeed, isBattleSpeed } from '../shared/roomOptions.js';
import { isPrepSeconds, normalizePrepSeconds, isPrepMultiplier, normalizePrepMultiplier } from '../shared/prepTime.js';
import { cleanPlayerCard, isCardPortraitId, cardPortraitOperatorId, isCardAvatarId, cardAvatarOperatorId } from '../shared/playerCard.js';
// server/lobby.js — rooms, seats, host, AI seats, ready/start, reconnect, and room → Match wiring
// (DESIGN §2, §6.1 LOBBY, §8.1). Implements the handler interface consumed by server/net.js.
//
// Rules (the choices where DESIGN is silent are marked ▸):
//   * Rooms are keyed by 4-letter codes from an unambiguous alphabet (no I/O, letters only). Join codes are
//     case-insensitive.
//   * 'solo' rooms hold exactly one human and never bots. 'coop' rooms have 4 seats (humans + AI bots).
//     Humans and bots take the lowest free seat index; seat indexes never compact.
//   * ▸ Being in a LOBBY room and sending room.create / room.join implicitly leaves it. While your room is
//     in a match, create/join of another room fails with ROOM_STARTED (send g.leave or room.leave first).
//   * room.create {mode, difficulty?, test?}: ▸ without a difficulty the room starts at DEFAULT_DIFFICULTY (标准) and the
//     host changes it in the room — the event's 联合模拟 creates the room first (research 06 §3.2), the starting
//     difficulty is not recorded [ASSUMED: 标准, the first one unlocked; the event room research 06 §3.2 describes shows
//     ♜ 标准模拟 in its footer pill]. The game's own lobby always sends the remembered one.
//   * Host-only: room.setDifficulty, room.setAiPicksLast, room.setSoloUnlimited, room.addBot, room.removeBot, room.kick,
//     room.start.
//     ▸ Changing the difficulty or the AI-picks-last option (co-op only) un-readies the other humans.
//     ▸ 「不限时」 (room.setSoloUnlimited { on }, DESIGN §35.23.10): a solo room of a version whose rules.soloTimed is
//       true, off by default. On, the match is built with opts.soloUnlimited (preparation and 机变 untimed — the existing
//       Match opt-out). room.state carries `soloUnlimited: true` only while it is on, so a default room.state stays
//       identical. A switch to a version whose solo is not timed clears it. A create that sends the key on a co-op room
//       or an untimed version is ignored.
//     ▸ room.start requires every other human to be connected and ready; the host's start counts as the host's
//     ready (the host may still toggle room.ready for display).
//   * room.kick {seat, playerId} (community report #17, owner approved): before the match only, the host removes another
//     human like an AI seat (an AI seat stays room.removeBot's; never the host itself). `playerId` names the player the
//     host confirmed: a seat that changed hands meanwhile (left, someone else joined) is refused with BAD_TARGET. The
//     seat is freed at once and the player gets `room.closed {reason:'kicked'}` — now, or on the next resume when
//     offline (with the result replay, as the grace timeout) —, so the reconnect token no longer leads back to the seat
//     (it stays the player's identity: net.js sessions belong to players, not seats). ▸ No ban: the player may join
//     again with the code.
//   * Host migration: when the host leaves (or is removed), the lowest-seat remaining human (connected
//     ones first) becomes host. A room without humans is disposed (bots never keep a room alive), except while its
//     matchmaking context still owns human teammates from outside the room. Its code/lane/checkpoint stay unchanged.
//   * Disconnect in LOBBY: the seat shows connected=false and is freed after `lobbyGraceMs` (60 s); a
//     session that comes back after that gets `room.closed {reason:'timeout'}`.
//     Disconnect in a match: the seat is kept and match.onDisconnect(playerId) is called.
//   * Reconnect: `hello` with a known token (reconnect window, 10 min, see net.js) rebinds the session;
//     the lobby then broadcasts room.state and, in a match, calls match.onReconnect(playerId).
//     Solo runs: this branch keeps disconnected solo matches for 6 hours (owner decision, 2026-10-18), overriding
//     the official data's singleReconnectTime (24 h). `soloReconnectWindowMs` may override the branch default.
//     This replaces the co-op 10-minute window — the untimed solo match
//     simply waits (net.js session.resumeWindowMs, set at every disconnect). Only after that does expiry turn into
//     match.onLeave ('abandoned'). The extension outlives the match, so a run that ended meanwhile (e.g. a server-run
//     Final Assault) still shows its result on the player's return.
//     A repeated hello on a live connection is a full resync: room.state goes to the requester only
//     (broadcast only when the seat visibly changed, e.g. a rename in LOBBY); the heavy part (match.onReconnect,
//     or the result replay below) runs at most once per `resyncMinGapMs` per session — extra requests inside
//     that window coalesce into one deferred resync, so hello spam cannot amplify into ~15 KB per request.
//   * Result replay: the match's final m.public and each human's m.result are kept after the match ends. A
//     human who resyncs (resume after a drop, a reloaded tab, a repeated hello) while the room is back in LOBBY
//     gets room.state followed by those two frames again, until they act in the room (ready, difficulty, the
//     AI-picks-last option, AI seats, start), leave it, or a new match starts. A human removed by the lobby grace
//     gets them right after `room.closed {timeout}` on their next resume (Match.onReconnect cannot do this: the
//     lobby drops the match reference at onEnd and disposes it on the next macrotask).
//   * Per-network limits (internet clients only, see net.js clientAddress): at most `maxRoomsPerAddr` rooms
//     created from one network may exist at once and at most `maxMatchesPerAddr` matches started from one
//     network may run at once (room.create / room.start → ERR.RATE). Without them a socket loop could fill
//     `maxRooms` or keep hundreds of unattended matches simulating for the whole reconnect window.
//     Defaults live in LOBBY_DEFAULTS and can be overridden per startServer option or with the SP_MAX_ROOMS,
//     SP_MAX_ROOMS_PER_ADDR and SP_MAX_MATCHES_PER_ADDR environment variables (docs/DEPLOY.md §3.4); every refusal
//     is logged (`room limit (N) reached …` / `match limit (N) reached …`, throttled to one line per 10 s).
//   * Permanent departure during a match (room.leave, g.leave, reconnect window expired): the seat is
//     marked departed (shown as connected=false), match.onLeave(playerId) is called, and the seat is freed
//     when the match ends. 'g.leave' is handled here and never reaches match.handle().
//   * All other 'g.*' messages go to room.match.handle(playerId, msg); its {ok}/{error} becomes the reply.
//   * Match lifecycle: room.start → new Match({...}) → room.state (inMatch=true) → match.start(). The match gets
//     `matchNo` = the room's match number (1, 2, …): with the seed it keeps battleIds unique across the room's
//     matches, so a late b.progress / b.result of the previous match is ignored by the next one (DESIGN §14).
//     onEnd(summary) → room back to LOBBY (departed seats freed, humans un-readied, disconnected humans
//     get the lobby grace), dispose() on the next macrotask. Players can start again.
//   * room.closed reasons: 'timeout' (removed after lobby grace), 'kicked' (room.kick, room.removeSpectator), 'empty' (a
//     spectator whose room lost its last player), 'shutdown' (server stopping).
//   * Operator loadout (DESIGN §16): room.loadout { entries } is checked strictly against the game data
//     (shared/protocol.js checkLoadout: known visible chess, a skill index legal for the normal AND the elite status, a
//     module of the elite or 'none'; any bad entry rejects the whole message, nothing is stored). ▸ It is stored on the
//     session (it follows the player into every room they create/join, and survives a resume) and on the seat; the
//     match receives seats[].loadout (bots: none — they fight with the defaults). ▸ Accepted any time: in a LOBBY room
//     (or outside a room) it simply replaces the stored one; while the room's match runs it is also handed to
//     match.setLoadout(playerId, loadout), which accepts it only during INFO_CHECK (the 干员调配 entry of the briefing)
//     and refuses it afterwards (WRONG_PHASE: the match's loadout is locked, the stored one applies to the next match).
//     ▸ Its `ops` (0.2.2: the per-operator 潜能 / 练度, shared/protocol.js checkLoadoutOps — an operator of the 干员调配
//     roster or the 自选 owned pool, strict like the entries) travel with it: session.ops / seat.ops / seats[].ops and
//     match.setLoadout(playerId, loadout, ops); a message without `ops` sets none (every operator 潜能 6, 精英2 Lv.60).
//   * Operator ownership (干员持有, 0.2.0 补位, owner's decision 2026-10-05): room.ownership { notOwned } — the base chess
//     ids the player marked as not owned — is checked leniently (shared/protocol.js checkNotOwned: anything that is not
//     a droppable NORMAL chess is dropped, never the whole list; only a malformed list is BAD_MSG) and stored on the
//     session and the seat like the loadout. The match receives seats[].notOwned when it starts (bots: none — they own
//     every operator) and keeps it for its whole length: the setting is out of match ("局外设置，下一局生效"), so while
//     the room's match runs a new list is only stored for the next match (ROOM_STARTED 'stored for the next match',
//     never handed to the match). A spectator's list stays on its session.
//   * 自选编队 (0.2.0 DIY, the owner's decisions of 2026-10-05): room.diy { picks } — the player's picks for the four DIY
//     slots ({ [slotBaseId]: { charId, skillIndex?, uniEquipId? } | null }) — is checked leniently (shared/protocol.js
//     checkDiyPicks against the game data and the kit registry, server/sim/content/kits/index.js KITTED_CHARS: an
//     illegal pick — an operator without a kit, another tier's prototype, a prototype off its locked skill, a second slot
//     of one owned operator, the same operator twice in a tier, an unknown slot / skill / module — is dropped, never the
//     whole roster; only malformed picks are BAD_MSG) and stored on the session and the seat exactly like the
//     not-owned list: the match receives seats[].diy when it starts (bots: none — they field no 自选 piece [ASSUMED]),
//     and a change while it runs is stored for the next match (ROOM_STARTED 'stored for the next match'). Every
//     `welcome` carries `diyKitted` (welcomeInfo): the operators a DIY slot may field, so the client's picker offers
//     exactly what the server accepts.
//   * 干员皮肤 (docs/SKINS.md): room.skins { skins } — `{ [charId]: skinId }`, the appearance each operator wears — is
//     a plain map of charIds to skinIds, at most SKIN_LIMITS.entries (256 [ASSUMED]); a bad shape is BAD_MSG and does
//     not clear the stored choice. A charId the room's content does not have is dropped (shared/protocol.js
//     checkSkinSelection). An unknown skinId can do nothing worse than fail to resolve in the client's spineEntry.
//     Stored on the session and the seat. Unlike
//     the settings above there is NO phase gate: a match receives seats[].skins when it starts AND takes a later change
//     at once (match.setSkins, any phase), because the choice is public — a teammate sees your model — and cosmetic.
//     The room's members see a seat's map as room.state seats[].skins (human seats with a non-empty map only, so a room
//     without skins sends what it sent before): the waiting room's 名片干员 seat cards wear the outfit of the operator
//     they show (the maintainer's decision 4 of 2026-10-21; the client picks that operator's entry — ui/seatArt.js
//     seatCardSkin — exactly as a match card reads Match.publicView().players[].skins). A changed map is broadcast while
//     the room waits; during a match its m.public carries it, and the room.state at the match's end. [ASSUMED] The whole
//     map rides in room.state, not one skinId per card: a seat without a pick shows an operator its clients choose by
//     player id (ui/seatArt.js seatOperator), which the server does not compute.
//   * 名片干员 (PR #643 split 6): room.card { charId } — the operator whose portrait fills the player's seat card in the
//     waiting room, '' for none — is kept only when it is a visible charId of the room's chess.json (another id, a hidden
//     preset, a stand-in body or a 自选-only operator: BAD_MSG, the stored one stays). Stored on the session (it follows the player into
//     the next room) and the seat; the room's members see it as room.state seats[].card (human seats with a card only,
//     so a room without one sends what it sent before). Checked again when the player takes a seat (humanSeat): a card
//     the room's content does not have (a plugin operator picked in a room with gameplay plugins) is left off that seat
//     — the session keeps it, and the player's page sends the card it can show for the room (ui/loadoutSync.js
//     installCardSync). Cosmetic: no phase gate, never handed to a match. [ASSUMED] A card picked in this browser stands
//     in for the event's account assistant (名片形象, display_meta_table avatarTypeData ASSISTANT); the client's default
//     for a seat without one is ui/seatArt.js'.
//   * Content identity (DESIGN §32, the plugin system's first step): the lobby is given the server's vanilla content
//     (server/plugins/identity.js; none in unit tests that build a Lobby without it). Every `welcome` carries
//     `content: { vanilla: <cs> }` — and `plugins: <n>` when this server has n > 0 unofficial plugins (every class but a
//     language: the title screen's 「本服务器安装了 N 个插件」; a page fetches the catalogue only when n > 0 and something
//     needs it, so a server without plugins sends exactly what it sent before) —, every room's `room.state.content` is
//     `{ cs, vanilla: true, plugins: [] }` while it has
//     no plugin, and the match receives `cs`, which it copies into every BattleSpec (the sim never reads it;
//     diagnostics and replays name the content with it).
//   * The room's plugins (DESIGN §32 P1a — cosmetic plugins only): room.setPlugins { plugins: [{ id }] } — host-only,
//     before the match, and ▸ like a difficulty change it un-readies the other humans. The lobby asks the server's
//     visual sets (server/plugins/visualSet.js resolve: loaded cosmetic plugins of scope `room`, their requirements
//     switched on, in load order, within the size limit — PLUGIN_UNKNOWN / PLUGIN_BLOCKED / PLUGIN_DEPENDENCY /
//     PLUGIN_CONFLICT / PLUGIN_LIMIT otherwise; none given to the Lobby → PLUGIN_UNKNOWN) and the room's content becomes
//     `{ cs, vanilla: true, vs, plugins: [{ id, version, class, hash, auto? }], warnings, bytes }`: `cs` stays the vanilla
//     one — art never changes a battle, so the match, its BattleSpecs and the golden results are those of the original
//     content and ▸ such a match counts as the original game in the statistics overview (the owner's decision of
//     2026-10-13: gameplay and numbers unchanged) —, `vs` names the
//     art every member's page draws with (/vs/<vs16>/overlay.json, composed by public/js/content.js on the page's own
//     manifest). An empty list brings back
//     exactly the vanilla shape above. The set is the room's: kept across its matches and a host change, held in the
//     visual sets while the room uses it (hold / release) and gone with the room. The same set again (the same `vs`)
//     un-readies nobody; ▸ when only its 「自动」 marks changed (a plugin first switched on automatically is now chosen, or
//     the other way round) the new state is broadcast without un-readying. A request that changes nothing (the same `vs`
//     and the same marks) — or a refused one — leaves the host's result replay (a settlement screen still open:
//     dropReplay; a change is the host moving on). ▸ When a plugin of the room's set changes on disk while the room holds
//     it (the visual sets' onStale, after the registry read the folders again), the host is told once (an m.toast: apply
//     the room's plugins again — the panel's 「重新应用」 sends the same list, which resolves to the set of the files as
//     they are now) — during a match, once the room is back in its lobby (onMatchEnd), when it can be done; nothing
//     changes by itself — ▸ but in a room the plugin studio names (DESIGN §32.9: `autoApplyPlugins`, set by
//     server/studio/index.js — a room whose host is the plugin's author or whose host is its only player) the same choice
//     is applied again at once, during a match too (refreshPlugins: art never changes a battle, the `cs` stays the vanilla
//     one; nobody is un-readied), and the host is told only when that fails.
//   * Gameplay plugins (DESIGN §32.6, P1c): room.setPlugins also takes the server's content plugins (data: numbers,
//     records, modes). The lobby's `plugins` (server/plugins/roomSets.js) closes the list over its requirements, refuses
//     conflicts, other classes and scopes, what the server owner's plugins/config.json does not allow and — unless it
//     allows them — gameplay plugins made for other game versions (PLUGIN_INCOMPATIBLE), and builds the room's content set:
//     a `cs` of its own (server/plugins/contentSets.js; at most limits.maxSets such sets held by rooms at once, else
//     PLUGIN_BUSY). The room's content is then `{ cs, vanilla: false, plugins: [{ id, version, class, hash, auto? }],
//     warnings, bytes, dataBytes, vs?, modes?, modeId? }` and ▸ the room is held to it like to a visual set (holdContent /
//     releaseContent). Its members' pages load and check that set (/cs/<cs16>/…, public/js/content.js) and say so with
//     room.contentReady { cs } — `seats[].content` (and `spectators[].content`) is 'loading' | 'ready' | 'failed' in such a
//     room only, reset to 'loading' when the set changes and when the member's socket drops (a reloaded page loads it
//     again); room.ready { ready: true } and room.start wait for every player's 'ready' (CONTENT_NOT_READY). A new room
//     starts with the policy's `default` plugins (none: the original game).
//     room.setMode { modeId } (host, before the match): an official mode of the room's type sets the difficulty; a mode
//     of the room's content set (content.modes, same room type) becomes content.modeId — the match's modeId — until the
//     host picks a difficulty or the set no longer has it; ▸ like a difficulty change it un-readies the other humans.
//     The match of such a room runs in that set's match host (server/match/host/ — a child process, a worker thread with
//     SP_MATCH_HOST=worker: hosts.create — the match is a MatchProxy whose answers are Promises), with opts.cs = the set's cs, opts.requireCs (a b.result naming another
//     content is refused) and opts.vs; ▸ every message and event of such a room is handled in order, one at a time, on
//     the room's own queue (serial): a request waits for the previous one's answer. A vanilla room never queues — its
//     match is in this process and answers at once, exactly as before. A loadout, 干员持有 list or 自选 roster stored while
//     the player was in a room of another content is filtered to the room's data when its match starts (an id the set
//     does not know is dropped, the rest kept — design study §6.9), and room.loadout / room.ownership / room.diy are
//     checked against the room's own data (and its 自选 list). When the worker stops (a crash, the watchdog), the match
//     ends with summary.reason 'plugin-crash' | 'plugin-hang' | 'plugin-start' and the room is back in its lobby.
//   * Spectator seats (community report #26, owner's decision 2026-10-04 — a remake feature, the official room has none):
//     room.spectate { code } takes one of a co-op room's MAX_SPECTATORS (2) spectator seats, in its lobby or while its
//     match runs (▸ solo rooms: ROOM_FULL). A spectator is not a player: never in `seats`, never counted for the 1–4 players
//     or the start gate, never host, never keeps a room alive (a room whose last human leaves closes with room.closed
//     {empty} for its spectators). It receives room.state (`spectators: [{ playerId, name, connected }]`) and every match
//     broadcast (m.public, m.ticker, m.emote, b.pool — public data); the match registers it (opts.spectators /
//     addSpectator) and shows it fields like an eliminated player (b.start watch / m.field), never an m.private. It may
//     only g.watch (the heavy bucket, like every watcher), g.leave / room.leave, and room.loadout / room.ownership /
//     room.diy (stored for its session, never handed to the match); anything else → SPECTATOR (▸ emotes too). Host: room.removeSpectator { playerId } any
//     time → room.closed {kicked} to it. A spectator in a LOBBY room may take a free player seat with room.join of the same
//     code; a player never switches to spectating in place (ALREADY). Disconnect / grace / reconnect / expiry work as for
//     a player seat (the seat is kept and given back on resume).
//   * Official versions (DESIGN §35.23, M1; shared/versions.js, server/versions.js): a room plays one official version,
//     `room.version` — room.create { version? } (omitted: the server's default version; refused VERSION_UNKNOWN when this
//     server does not enable it, VERSION_UNSUPPORTED when it does not offer the room mode, its data failed to load
//     (server/versions.js available; welcome then omits it) or the server owner's fixed plugins (plugins/config.json
//     rooms: fixed) cannot play it; a difficulty the version lacks is lowered — the highest it
//     offers below, else its lowest: 终极 → 绝境). A room of 第二期下半 (act2autochess, the code constant DEFAULT_VERSION)
//     is exactly the room of before: no new key in its room.state, its match in this process. Another version's room:
//     room.state.version, its content `{ cs: <the version's cs>, vanilla: true, version, plugins }` (official — never
//     unofficial; cosmetic plugins only: gameplay plugins play 第二期下半 only, VERSION_UNSUPPORTED), every member's page
//     loads and checks that version's data like a gameplay plugin's set (room.needsContent: seats[].content, contentReady,
//     CONTENT_NOT_READY), room.setDifficulty / room.setMode accept only the version's modes (BAD_TARGET), settings are
//     checked against its data, and its match runs in that version's match host (server/match/host/, kind 'version':
//     opts.version, opts.requireCs) — never in this process, whose module singletons hold 第二期下半's data (INTERNAL
//     without one, unless a test gave its own MatchClass).
//     The version switch, before the match, modelled on 重刷 (server/match/match/setupVote.js): the host proposes
//     (room.proposeVersion { version }: refused NOT_IN_ROOM, SPECTATOR, NOT_HOST, ROOM_STARTED, VERSION_UNKNOWN,
//     VERSION_UNSUPPORTED — the room mode, or gameplay plugins on and the target not 第二期下半 —, ALREADY, VERSION_VOTE,
//     RATE — `versionProposeGapMs` (300 ms) since the last proposal, `versionRetryMs` (5 s) after a declined or expired
//     vote [ASSUMED] —, NOT_READY — a seated human offline —, VERSION_UNSUPPORTED when the target's data failed to load,
//     and VERSION_UNSUPPORTED again when the room's cosmetic plugins do not resolve on the target, checked last);
//     ▸ a lone active human switches at once; otherwise a vote opens: voters = the seated humans then (seat order; AI and
//     spectators never vote), the host counted as agreed, `versionVoteMs` (60 s [ASSUMED]: a room has no clock to pause,
//     unlike 重刷) to answer. room.versionVote { voteId, agree }: a decline cancels (toast to every member), the last
//     agreement switches. room.cancelVersionVote { voteId } (host). A seat taken by a human (a join, a spectator sitting
//     down), a player seat freed (leave, kick, grace timeout, expiry), a host change, a voter's socket dropping and a
//     match start void it (toast); spectators coming or going and AI seats do not. While it is open room.start,
//     room.setPlugins and room.setMode answer VERSION_VOTE. room.state.versionVote { id, proposerId, version, voters,
//     agreed, remainingMs } while open (remainingMs: a duration by the lobby's clock, never a wall clock).
//     The switch (applyVersion): room.version, the difficulty lowered as at create, the content the version's base with
//     the room's cosmetic plugins applied again (none when they do not resolve there), every member's page loading it
//     again, the other humans un-readied, the WHOLE result replay dropped (its frames name the old version's chess ids),
//     every human seat's loadout / 潜能 / 干员持有 / 自选 cleared (the pages send them again) and a seat card the version
//     lacks dropped. ▸ A setting sent in such a room before its page reported the room's content ready is kept unverified
//     (the version's chess ids are reused with other operators: chess_char_1_02 is 角峰 in 第二期, 讯使 in 第一期) — a
//     version room's match then drops that loadout's skill / module choices and that 干员持有 list whole, while 潜能 /
//     练度 and 自选 (keyed by charId) are checked again against the version's data (seatSettings); a setting checked for
//     another content keeps only the ids whose operator (charId) is the same in both data sets.

import { aiTakeover, resetAiTakeover, reconcileAiTakeover } from './aiTakeover.js';
import { randomBytes, randomInt } from 'node:crypto';
import { EMOTES, EMOTE_COOLDOWN_MS, ERR, MAX_SEATS, MAX_SPECTATORS, ROOM_CODE_LEN, DIFFICULTIES, modeIdFor } from '../shared/constants.js';
import { checkLoadout, checkLoadoutOps, cultivationCharIds, checkNotOwned, checkDiyPicks, charPotentialChanges, checkSkinSelection, operatorCharIds } from '../shared/protocol.js';
import { encode, isDroppable, isErrCode, sendRaw, sendSession } from './net.js';
import { resetStateDelta } from './stateTransport.js';
import { getData as defaultGetData, lookup } from './data.js';
import { Match as DefaultMatch } from './match/Match.js';
import { restoreMatch as applyMatchCheckpoint } from './match/snapshot.js';
import { createRngFromState } from './sim/rng.js';
import { KITTED_CHARS } from './sim/content/kits/index.js';
import { t } from '../shared/i18n.js';
import { validChatText } from '../shared/chat.js';

const VANILLA_KITTED = new Set(KITTED_CHARS);
import { isContentHash } from '../shared/plugins/identity.js';
import { ruleOption } from '../shared/plugins/rules.js';
import { msg, wireMessage } from '../shared/i18n.js';
import { freezeSkins } from '../shared/skins.js';
import { DEFAULT_VERSION } from '../shared/versions.js';
import { parseTestModeEnv, testModeGate, unrecognizedTestMode } from './testMode.js';

/** Room code alphabet: uppercase letters without I and O (and no digits, so no 0/1). */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

/** Tunables. */
export const LOBBY_DEFAULTS = Object.freeze({
  lobbyGraceMs: 60_000,   // disconnected humans keep their lobby seat this long
  maxRooms: 1000,
  maxRoomsPerAddr: 16,    // rooms created from one client network that may exist at once (0 = unlimited)
  maxMatchesPerAddr: 8,   // matches started from one client network that may run at once (0 = unlimited)
  resyncMinGapMs: 1000,   // heavy resyncs (match state / result replay) per session at most this often on repeated hellos
  soloReconnectWindowMs: 6 * 60 * 60_000, // reclaim disconnected solo matches after 6 hours
  matchmakingTickMs: 1_000,    // queue scheduling cadence
  versionVoteMs: 60_000,  // an open version vote is cancelled after this long (header "Official versions") [ASSUMED]
  versionRetryMs: 5_000,  // no new version proposal this long after a declined or expired vote [ASSUMED]
  versionProposeGapMs: 300, // nor this soon after the last proposal (重刷's debounce)
  roomCode: null,         // --room-code / roomCode: a fixed alliance key for every new room (null = random per room)
});

/** The stamp of a setting a version room's page sent before it reported the room's content ready (header). */
const UNVERIFIED_CS = 'unverified';

/**
 * The difficulty of a room created without one (room.create's `difficulty` left out; see the header) [ASSUMED: 标准 —
 * the event's room is changed by its creator after 创建同盟, its starting difficulty is not recorded; the event room of
 * research 06 §3.2 shows ♜ 标准模拟 in its footer pill].
 */
export const DEFAULT_DIFFICULTY = 'FUNNY';

/** Branch retention fallback; generated official data is unchanged. */
export const SOLO_RECONNECT_FALLBACK_SEC = 6 * 60 * 60;

/** Display names for AI teammates (the tutorial NPCs first, then a few familiar faces). */
export const BOT_NAMES = Object.freeze(['AI·华法琳', 'AI·阿米娅', 'AI·惊蛰', 'AI·杜宾', 'AI·凯尔希', 'AI·可露希尔']); // i18n-ignore: player names (docs/I18N.md)

const OK = Object.freeze({ ok: true });
const fail = (code, detail) => (detail ? { error: code, detail } : { error: code });
/** A match's answer to a request as the platform replies it: OK, or its error (an unknown code: INTERNAL). */
const matchAnswer = (res) => (res && typeof res === 'object' && res.error
  ? fail(isErrCode(res.error) ? res.error : ERR.INTERNAL, typeof res.detail === 'string' ? res.detail : undefined)
  : OK);
const noopLog = { info() {}, warn() {}, error() {}, debug() {} };

/**
 * @typedef {{ seat: number, playerId: string, name: string, isBot: boolean, ready: boolean,
 *             connected: boolean, left: boolean, loadout?: Record<string, { skill: number, module: string|null }> | null,
 *             card?: { charId: string, avatar: string } | null,
 *             ops?: Readonly<Record<string, { potential: number, cultivate: number }>> | null,
 *             notOwned?: readonly string[] | null, diy?: Readonly<Record<string, DiyLoadout>> | null,
 *             skins?: Readonly<Record<string, string>> | null,
 *             content?: 'ready' | 'failed' | null, contentGen?: number, loadoutCs?: string | null, notOwnedCs?: string | null,
 *             diyCs?: string | null, consentCs?: string | null }} Seat
 *   content: a room with gameplay plugins — whether the player's page loaded and checked its content (header "Gameplay
 *   plugins"; null = still loading); contentGen: counts the seat's disconnects (a queued room.contentReady of an earlier
 *   page no longer counts); loadoutCs / notOwnedCs / diyCs: the content its settings were checked for
 * @typedef {{ charId: string, skillIndex: number, uniEquipId: string|null }} DiyLoadout
 */

/** Deep-frozen copy of a checked loadout (shared by the session, the seat and the match's PlayerState). */
function freezeLoadout(loadout) {
  const out = {};
  for (const [id, e] of Object.entries(loadout || {})) out[id] = Object.freeze({ skill: e.skill, module: e.module ?? null });
  return Object.freeze(out);
}

/** Deep-frozen copy of checked operator settings (0.2.2 潜能 / 练度; shared by the session, the seat and the match). */
function freezeOps(ops) {
  const out = {};
  for (const [id, e] of Object.entries(ops || {})) out[id] = Object.freeze({ potential: e.potential, cultivate: e.cultivate });
  return Object.freeze(out);
}

/** The charIds a player may set a potential / 练度 for, per data object (shared/protocol.js cultivationCharIds). */
const OPS_IDS = new WeakMap();
function opsCharIds(data) {
  if (!data || typeof data !== 'object') return new Set();
  let ids = OPS_IDS.get(data);
  if (!ids) { ids = cultivationCharIds(data.chess, data.backups); OPS_IDS.set(data, ids); }
  return ids;
}

/** The operator charIds of a data object's chess.json that a player can see (room.card's whitelist, the client's picker
 * list: no hidden preset, no stand-in or 自选-only body). */
const CHESS_IDS = new WeakMap();
function chessCharIds(data) {
  const chess = data && typeof data.chess === 'object' ? data.chess : null;
  if (!chess) return new Set();
  let ids = CHESS_IDS.get(chess);
  if (!ids) {
    ids = new Set();
    for (const c of Object.values(chess)) if (c && !c.isDiy && c.visible !== false && typeof c.charId === 'string') ids.add(c.charId);
    CHESS_IDS.set(chess, ids);
  }
  return ids;
}

/** Deep-frozen copy of checked 自选 picks (shared by the session, the seat and the match's PlayerState). */
function freezeDiy(picks) {
  const out = {};
  for (const [id, p] of Object.entries(picks || {})) out[id] = Object.freeze({ charId: p.charId, skillIndex: p.skillIndex, uniEquipId: p.uniEquipId ?? null });
  return Object.freeze(out);
}

/**
 * Frozen copy of a skin selection (docs/SKINS.md), keyed by operator charId.
 *
 * A non-plain object, a key that is not a charId, a value that is not a skinId, or a map over the wire cap is refused
 * (`null` — the caller answers BAD_MSG and does not clear what is already stored). A charId `hasOperator` rejects is
 * dropped. The stored copy is then at most the operator count of the room's content, and ≤ 256 [ASSUMED].
 * @param {Record<string, string>} skins `{ [charId]: skinId }`
 * @param {(charId: string) => boolean} hasOperator
 * @returns {Readonly<Record<string, string>>|null}
 */
/** Do two skin selections hold the same pairs (a resend of the same map is not broadcast again)? */
function sameSkins(a, b) {
  const ka = a ? Object.keys(a) : [], kb = b ? Object.keys(b) : [];
  return ka.length === kb.length && ka.every((k) => a[k] === b[k]);
}

/** One room: 4 seat slots, host, difficulty, optional running match. */
export class Room {
  /**
   * @param {string} code @param {'solo'|'coop'} mode @param {string} difficulty @param {number} now
   * @param {string} [version] the official version the room plays (header "Official versions")
   */
  constructor(code, mode, difficulty, now, version = DEFAULT_VERSION) {
    this.code = code;
    this.mode = mode;
    this.difficulty = difficulty;
    /** the official version the room plays (shared/versions.js id; header "Official versions") */
    this.version = version;
    /**
     * the open version vote, else null: `{ id, proposerId, version, voters, agreed, expiresAt, timer }`
     * @type {{ id: number, proposerId: string, version: string, voters: string[], agreed: Set<string>, expiresAt: number, timer: any } | null}
     */
    this.versionVote = null;
    /** the last vote id (room.state.versionVote.id: 1, 2, …) */
    this.versionVoteSeq = 0;
    /** the lobby clock of the last proposal, and the time before which no proposal is taken (a declined / expired vote) */
    this.versionProposeAt = -Infinity;
    this.versionRetryAt = -Infinity;
    /**
     * 「AI 队友最后选择」 (room.setAiPicksLast, GitHub #338; co-op only, off by default): the match's strategy and 机变 drafts
     * put every human seat before every AI seat (Match opts.aiPicksLast). Kept across the room's matches.
     */
    this.aiPicksLast = false;
    // [ASSUMED] Remake cooperation option, approved 2026-10-24; host opt-in before the match.
    this.aiTakeoverEnabled = false;
    /**
     * 「不限时」 (room.setSoloUnlimited, DESIGN §35.23.10; a timed solo only, off by default): the match is built with
     * opts.soloUnlimited. room.state omits the key unless this is true.
     */
    this.soloUnlimited = false;
    /** @type {string | null} */
    this.hostId = null;
    /** @type {(Seat | null)[]} */
    this.seats = new Array(MAX_SEATS).fill(null);
    /** @type {{ playerId: string, name: string, connected: boolean }[]} spectator seats, ≤ MAX_SPECTATORS (header) */
    this.spectators = [];
    /** @type {any} running Match instance */
    this.match = null;
    /** @type {{ live: boolean, ended: boolean, disposed: boolean, match: any } | null} */
    this.matchCtx = null;
    this.matchCount = 0;
    /** @type {any} summary passed to onEnd by the last match */
    this.lastSummary = null;
    /**
     * Frames of the last match's end, replayed on resync to humans who have not moved on yet.
     * @type {{ publicFrame: string | null, frames: Map<string, string>, pending: Set<string> } | null}
     */
    this.replay = null;
    /** @type {string[] | null} plugins of the room's set that changed on disk — the host not told yet (Lobby.pluginsChanged) */
    this.pluginsChanged = null;
    this.pluginNoticeKeys = {};
    /** @type {string | null} per-network limit key of the creator (net.js clientAddress) */
    this.ownerKey = null;
    /** @type {string | null} per-network limit key of whoever started the running match */
    this.matchKey = null;
    /** @type {{ queueId: string, queuedAt: number, count: number, capacity: number } | null} */
    this.matching = null;
    /** Owner opt-in for the in-match developer console. Public matchmaking never has a Room flag. */
    this.consoleEnabled = false;
    this.prepSeconds = null;
    this.prepMultiplier = null;
    this.battleSpeed = 2;
    this.createdAt = now;
    this.disposed = false;
    /**
     * The content set the room plays (DESIGN §32): `{ cs, vanilla, plugins }` — the server's vanilla set, or with the
     * cosmetic plugins its host switched on (header "The room's plugins": `vs`, `warnings`, `bytes` beside them), or a
     * content set with gameplay plugins (header "Gameplay plugins": `vanilla: false`, its own cs, `dataBytes`, `modes`,
     * `modeId`); null when the lobby has no content identity (room.state then carries none).
     * @type {Readonly<{ cs: string, vanilla: boolean, plugins: readonly object[], vs?: string, warnings?: readonly object[],
     *   bytes?: number, dataBytes?: number, modes?: readonly object[], modeId?: string }> | null}
     */
    this.content = null;
    /** Test room (DESIGN §34.8). Set only at create, and only when the process switch is on. Never flipped later. */
    this.test = false;
    /** the room's queue (header "Gameplay plugins": Lobby.serial): what is still waiting or running, and its tail */
    this.queue = { pending: 0, tail: Promise.resolve() };
  }

  /** Does the room play a content set with gameplay plugins (its own cs; header "Gameplay plugins")? */
  get modded() { return !!this.content && this.content.vanilla === false; }

  /**
   * Must every member's page load and check the room's content before ready / start (header "Gameplay plugins",
   * "Official versions")? A set with gameplay plugins, or another official version than 第二期下半.
   */
  get needsContent() { return this.modded || this.version !== DEFAULT_VERSION; }

  /** @param {string} playerId @returns {Seat | null} */
  seatOf(playerId) {
    for (const s of this.seats) if (s && s.playerId === playerId) return s;
    return null;
  }

  /** @param {string} playerId @returns {{ playerId: string, name: string, connected: boolean } | null} */
  spectatorOf(playerId) { return this.spectators.find((s) => s.playerId === playerId) || null; }

  /** Lowest free seat index, or -1. */
  freeSeat() { return this.seats.indexOf(null); }

  /** Humans that have not departed, in seat order. @returns {Seat[]} */
  activeHumans() { return this.seats.filter((s) => s && !s.isBot && !s.left); }

  /**
   * `room.state` frame (DESIGN §8.1) plus `inMatch`.
   * @param {number} [now] the lobby's clock (an open version vote's remainingMs)
   */
  toState(now = Date.now()) {
    return {
      t: 'room.state',
      ...(this.aiTakeoverEnabled ? { aiTakeoverEnabled: true, aiTakeoverVotes: this.aiTakeoverVotes || [] } : {}),
      code: this.code,
      hostId: this.hostId,
      mode: this.mode,
      difficulty: this.difficulty,
      aiPicksLast: this.aiPicksLast,
      inMatch: !!this.match,
      matching: this.matching ? { ...this.matching } : null,
      consoleEnabled: !!this.consoleEnabled,
      prepSeconds: this.prepSeconds,
      prepMultiplier: this.prepMultiplier,
      battleSpeed: this.battleSpeed,
      seats: this.seats.map((s) => (s
        ? { seat: s.seat, playerId: s.playerId, name: s.name, ...(s.avatarId?{avatarId:s.avatarId}:{}), ...(s.publicId?{publicId:s.publicId}:{}), isBot: s.isBot, ready: s.ready, connected: s.connected && !s.left,
          ...(!s.isBot && s.card ? { card: s.card } : {}),
          ...(!s.isBot && s.skins && Object.keys(s.skins).length ? { skins: s.skins } : {}),
          ...(this.needsContent && !s.isBot ? { content: s.content || 'loading' } : {}) }
        : null)),
      spectators: this.spectators.map((s) => ({ playerId: s.playerId, name: s.name, connected: s.connected, ...(this.needsContent ? { content: /** @type {any} */ (s).content || 'loading' } : {}) })),
      ...(this.content ? { content: this.content.trusted ? {...this.content, trusted:{...this.content.trusted, consent:Object.fromEntries(this.seats.filter(x => x && !x.isBot).map(x => [x.seat,x.consentCs === this.content.cs]))}} : this.content } : {}),
      // another official version than 第二期下半, and its open vote (header "Official versions"): omitted otherwise, so a
      // default room's room.state stays identical
      ...(this.version !== DEFAULT_VERSION ? { version: this.version } : {}),
      ...(this.versionVote ? { versionVote: { id: this.versionVote.id, proposerId: this.versionVote.proposerId, version: this.versionVote.version,
        voters: [...this.versionVote.voters], agreed: this.versionVote.voters.filter((id) => this.versionVote?.agreed.has(id)),
        remainingMs: Math.max(0, Math.round(this.versionVote.expiresAt - now)) } } : {}),
      // omitted when false so a normal room.state stays identical
      ...(this.test ? { test: true } : {}),
      // 「不限时」 (header): omitted unless on, so a default room.state stays identical
      ...(this.soloUnlimited === true ? { soloUnlimited: true } : {}),
    };
  }
}

/** Room registry + lobby message handlers. Pass an instance as the `handler` of net.js Network. */
export class Lobby {
  /**
   * @param {{
   *   registry: import('./net.js').SessionRegistry,
   *   log?: { info: Function, warn: Function, error: Function, debug?: Function },
   *   MatchClass?: new (opts: object) => any,
   *   getData?: () => object,
   *   now?: () => number,
   *   seedFn?: () => number,
   *   content?: { cs: string } | null,
   *   plugins?: { resolve: (ids: string[], opts?: { scope?: 'room' | 'personal', settings?: object, replacing?: object | null }) => any,
   *     hold?: (vs: string) => void, release?: (vs: string) => void, holdContent?: (cs: string) => void,
   *     releaseContent?: (cs: string) => void, onContentStale?: (fn: (cs: string, ids: string[]) => void) => () => void, onStale?: (fn: (vs: string, ids: string[]) => void) => () => void,
   *     unofficial?: () => number, hasNotices?: () => boolean, defaults?: () => string[], dataOf?: (cs: string) => any, kittedOf?: (cs: string) => any,
   *     contentInUse?: () => number } | null,
   *   hosts?: { create: (cs: string, opts: object) => any, stats?: () => object } | null,
   *   versions?: ReturnType<typeof import('./versions.js').createVersionSets> | null,
   *   versionHosts?: { create: (cs: string, opts: object) => any, stats?: () => object } | null,
   *   options?: Partial<typeof LOBBY_DEFAULTS>,
   *   workerPool?: object | null,
   *   matchWorkerPool?: object | null,
   *   nameModeration?: { checkChat?: Function } | null,
   * }} opts
   *   content: the server's vanilla content (server/plugins/identity.js; header "Content identity"); plugins: what a host
   *   chooses from — the room's sets (server/plugins/roomSets.js: visual sets and content sets; header "The room's
   *   plugins", "Gameplay plugins"); hosts: the match hosts a room with gameplay plugins runs its match in
   *   (server/match/host/index.js; none: such a match runs here, unit tests); versions: the official versions this server
   *   offers (server/versions.js; none: 第二期下半 alone — header "Official versions"); versionHosts: the match hosts of
   *   the other versions (server/match/host/index.js, kind 'version')
   */
  constructor({ registry, log = noopLog, MatchClass = DefaultMatch, getData = defaultGetData, now = Date.now, seedFn, content = null, plugins = null, hosts = null, versions = null, versionHosts = null, simPool = null, options = {}, workerPool = null, matchWorkerPool = null, nameModeration = null }) {
    this.registry = registry;
    /** the vanilla content set every room plays (header "Content identity"), or null */
    this.vanilla = content && isContentHash(content.cs) ? Object.freeze({ cs: content.cs, vanilla: true, plugins: Object.freeze([]) }) : null;
    /** the server's room sets — visual and content (header "The room's plugins", "Gameplay plugins"), or null */
    this.plugins = plugins;
    /** the match hosts (header "Gameplay plugins"), or null */
    this.hosts = hosts;
    /** the official versions this server offers and their match hosts (header "Official versions"), or null */
    this.versions = versions;
    this.versionHosts = versionHosts;
    /**
     * The server's own simulation pool for bot rehearsals (server/workers/roomPool.js), or null when the operator
     * started none — then every rehearsal stays on this thread, exactly as before.
     */
    this.simPool = simPool;
    this.log = log;
    this.MatchClass = MatchClass;
    this.getData = getData;
    this.workerPool = workerPool;
    this.matchWorkerPool = matchWorkerPool;
    this.nameModeration = nameModeration;
    this.chatReviews = new WeakMap();
    this.roomMessagesAt = new WeakMap();
    this.shuttingDown = false;
    this.now = now;
    this.seedFn = seedFn || (() => randomInt(2 ** 32));
    const testModeOpt = options.testMode;
    const testHostOpt = options.testHost;
    if (Object.hasOwn(options, 'testMode') || Object.hasOwn(options, 'testHost')) {
      options = { ...options };
      delete options.testMode;
      delete options.testHost;
    }
    this.opts = { ...LOBBY_DEFAULTS, ...options };
    // A fixed alliance key (--room-code / roomCode): every room this process creates uses it. server/index.js parses
    // the argument once at startup; a test passes it directly. Nothing is read from the environment or persisted.
    if (this.opts.roomCode) {
      // The fixed key is an admission secret: ordinary room lifecycle logs must not expose it either.
      const key = this.opts.roomCode;
      this.log = Object.fromEntries(['info', 'warn', 'error', 'debug'].map(level => [level,
        (...args) => log[level]?.(...args.map(value => typeof value === 'string' ? value.split(key).join('[fixed room]') : value)),
      ]));
    }
    // Test rooms stay off until the bound address is known (setTestHost). An empty host fails closed, so a
    // server that is about to bind 0.0.0.0 does not briefly accept test rooms on the default. [ASSUMED] the
    // env words are parsed in server/testMode.js.
    const rawMode = testModeOpt != null ? testModeOpt : (typeof process !== 'undefined' && process.env ? process.env.SP_TEST_MODE : undefined);
    this.testMode = parseTestModeEnv(rawMode);
    this.testUnrecognized = unrecognizedTestMode(rawMode);
    this.testHost = '';
    this.testEnabled = false;
    this.testWarn = this.testUnrecognized;
    if (testHostOpt != null) this.setTestHost(testHostOpt);
    /** @type {Map<string, Room>} */
    this.rooms = new Map();
    this.userOutbox = new Map();
    this.userPendingIds = new Set();
    this.userWrites = new Set();
    /** @type {Map<string, NodeJS.Timeout>} lobby grace timers by playerId */
    this.graceTimers = new Map();
    /** @type {Map<string, NodeJS.Timeout>} deferred (coalesced) resyncs by playerId */
    this.resyncTimers = new Map();
    /** per-network limit warnings: at most one log line per 10 s (the rest are counted) */
    this.limitLog = { at: -Infinity, suppressed: 0 };
    /** @type {Map<string, any[]>} queue buckets keyed by mode + difficulty */
    this.matchQueues = new Map();
    /** @type {Map<string, any>} one active queue entry per human player */
    this.queueByPlayer = new Map();
    /** @type {Set<object>} running matchmaking contexts, including standalone matches */
    this.activeQueueMatches = new Set();
    /** Checkpoints that need another recovery attempt; persistence retains their original identities and state. */
    this.recoveryDocs = new Map();
    /** @type {Function | null} */
    this.onMatchStarted = null;
    this.queueSeq = 0;
    this.matchQueueTimer = setInterval(() => this.processMatchQueues(), Math.max(100, Number(this.opts.matchmakingTickMs) || 1000));
    this.matchQueueTimer.unref?.();
    /** log lines said once (warnOnce) */
    this.told = new Set();
    /** a held visual set whose plugins changed on disk: its rooms' hosts are told (header "The room's plugins") */
    this.offStale = typeof plugins?.onStale === 'function' ? plugins.onStale((vs, ids) => this.pluginsChanged(vs, ids)) : null;
    /**
     * Whether a room applies a change of its plugins on disk by itself (header "The room's plugins"): `({ code, hostId,
     * humans, inMatch }) => boolean`, set by the plugin studio (server/studio/index.js); null — every host is told.
     * @type {((room: { code: string, hostId: string, humans: number, inMatch: boolean }) => boolean) | null}
     */
    this.autoApplyPlugins = null;
    this.offContentStale = plugins?.onContentStale?.((cs, ids) => this.pluginsChanged(cs, ids, 'content')) || null;
  }

  /** Return the room-pinned lane when enabled. */
  workerPoolFor(key) {
    return this.workerPool?.assign ? this.workerPool.assign(key) : this.workerPool;
  }

  /**
   * The address this process bound. Test rooms stay disabled until this runs. `host` empty fails closed.
   * @param {string} host
   * @returns {{ enabled: boolean, warn: string|null }}
   */
  setTestHost(host) {
    this.testHost = typeof host === 'string' ? host : '';
    const gate = testModeGate(this.testMode, this.testHost);
    this.testEnabled = gate.enabled === true;
    this.testWarn = this.testUnrecognized || gate.warn;
    return { enabled: this.testEnabled, warn: this.testWarn };
  }

  /**
   * The plugins `ids` of the visual set `vs` changed on disk: the host of every room using it is told to apply the room's
   * plugins again (header "The room's plugins") — a host offline now misses it; the panel's 「重新应用」 is always there.
   * @param {string} vs @param {string[]} ids
   */
  pluginsChanged(vs, ids, kind = 'visual') {
    for (const room of this.rooms.values()) {
      if (room.disposed || (kind === 'content' ? room.content?.cs : room.content?.vs) !== vs) continue;
      const noticeKey = `${room.content?.cs}|${room.content?.vs || ''}`;
      if (room.pluginNoticeKeys[kind] === noticeKey) continue;
      // the plugin studio's rooms (the author hosts, or plays alone): the same choice again at once (refreshPlugins)
      let auto;
      try { auto = !!this.autoApplyPlugins?.({ code: room.code, hostId: room.hostId, humans: room.activeHumans().length, inMatch: !!room.match }); } catch { auto = false; }
      if (kind === 'visual' && auto && this.refreshPlugins(room)) continue;
      room.pluginNoticeKeys[kind] = noticeKey;
      this.log.info(`[lobby] ${room.code} plugins changed on disk: ${ids.join(', ')} — the host is asked to apply them again`);
      // during a match the panel cannot change them: the host hears it once the room is back in its lobby (onMatchEnd)
      room.pluginsChanged = [...new Set([...(room.pluginsChanged || []), ...ids])];
      if (!room.match) this.tellPluginsChanged(room);
    }
  }

  /**
   * Apply a room's plugins again as they are on disk now (header "The room's plugins": the plugin studio's rooms) — the
   * plugins its host chose (not the 「自动」 ones), resolved again (resolveContent); the room's content becomes the new set,
   * held in its place, and every member hears it. Allowed during a match: a cosmetic set never changes a battle (the `cs`
   * stays the vanilla one) and nobody is un-readied. Only a room of cosmetic plugins: one with gameplay plugins (DESIGN
   * §32.6) would get another `cs` — every page loads and checks it again, the players are un-readied, a match keeps its
   * set — so its host is told instead, as is the host of a room whose plugins would now make one. Whether it worked
   * (false: the host is told).
   * @param {Room} room
   */
  refreshPlugins(room) {
    const before = room.content;
    if (!before?.vs || before.vanilla === false || !this.vanilla || !this.plugins) return false;
    const ids = before.plugins.filter((p) => !p.auto).map((p) => p.id);
    const r = this.resolveContent(room, ids);
    if (!('content' in r) || !r.content) { this.log.info(`[lobby] ${room.code} plugins changed on disk and no longer apply: ${'detail' in r && r.detail ? r.detail : ('error' in r ? r.error : '?')}`); return false; }
    const next = r.content;
    if (next.vanilla === false || !next.vs) return false;
    room.pluginsChanged = null;
    if (next.vs === before.vs) return true;
    room.content = next;
    this.holdContent(next);
    this.releaseContent(before);
    this.log.info(`[lobby] ${room.code} plugins applied again: ${next.plugins.map((p) => `${p.id}@${p.version}`).join(', ')}`);
    this.broadcastState(room);
    return true;
  }

  /** Tell the host of `room` that its plugins changed on disk (pluginsChanged), once. @param {Room} room */
  tellPluginsChanged(room) {
    const ids = room.pluginsChanged;
    room.pluginsChanged = null;
    // the room's set changed since (re-applied, switched off): nothing to tell
    if (!ids || !room.content?.plugins?.length) return;
    const names = ids.slice(0, 8).join('、');
    this.sendToPlayer(room, room.hostId, { t: 'm.toast', kind: 'warn', ...wireMessage(msg('房间插件「{names}」的文件在服务器上变了，请在插件面板中点「重新应用」', { names })) });
  }

  /** @param {string} code @returns {Room | null} */
  getRoom(code) { return this.rooms.get(String(code).toUpperCase()) || null; }

  /** Counters for /healthz. */
  stats() {
    let matches = 0;
    let humans = 0;
    let bots = 0;
    let queued = 0;
    let spectators = 0;
    for (const r of this.rooms.values()) {
      if (r.match) matches++;
      for (const s of r.seats) if (s && !s.left) (s.isBot ? bots++ : humans++);
      spectators += r.spectators.length;
    }
    const entries = new Set(this.queueByPlayer.values());
    queued = entries.size;
    const roomMatches = matches;
    let standaloneMatches = 0;
    for (const ctx of this.activeQueueMatches) if (!ctx.room && !ctx.disposed && !ctx.ended) standaloneMatches++;
    matches += standaloneMatches;
    return { rooms: this.rooms.size, matches, roomMatches, standaloneMatches, humans, bots, spectators, queued };
  }

  /**
   * Aggregate per-network room/match usage for /metrics (docs/DEPLOY.md §3.4): how many client networks are already at
   * one of the caps and how close the worst one is. No addresses here — /metrics is public, the refusal logs name the
   * network (`room limit (16) reached for 203.0.113.7`).
   * @returns {{ rooms: number, matches: number, networks: number, worstRooms: number, worstMatches: number,
   *             overRooms: number, overMatches: number }}
   */
  usage() {
    /** @type {Map<string, { rooms: number, matches: number }>} */
    const per = new Map();
    let matches = 0;
    for (const r of this.rooms.values()) {
      if (r.match) matches++;
      if (!r.ownerKey) continue;
      const e = per.get(r.ownerKey) || { rooms: 0, matches: 0 };
      e.rooms++;
      if (r.match) e.matches++;
      per.set(r.ownerKey, e);
    }
    let worstRooms = 0;
    let worstMatches = 0;
    let overRooms = 0;
    let overMatches = 0;
    for (const e of per.values()) {
      if (e.rooms > worstRooms) worstRooms = e.rooms;
      if (e.matches > worstMatches) worstMatches = e.matches;
      if (this.opts.maxRoomsPerAddr > 0 && e.rooms >= this.opts.maxRoomsPerAddr) overRooms++;
      if (this.opts.maxMatchesPerAddr > 0 && e.matches >= this.opts.maxMatchesPerAddr) overMatches++;
    }
    return { rooms: this.rooms.size, matches, networks: per.size, worstRooms, worstMatches, overRooms, overMatches };
  }

  // ---------------------------------------------------------------------------------------------------
  // net.js handler interface
  // ---------------------------------------------------------------------------------------------------

  /**
   * After `welcome`: resend room state / match state for resumed (or repeated) hellos.
   * @param {import('./net.js').Session} session
   * @param {{ resumed: boolean, repeat: boolean }} info
   */
  onHello(session, { resumed, repeat }) {
    if (!resumed && !repeat) return;
    const room = this.roomOf(session);
    const active = this.activeMatchOf(session);
    if (!room) {
      if (active && active.match && !active.ended) {
        this.resync(session, !resumed);
        return;
      }
      if (session.notice) {
        sendSession(session, { t: 'room.closed', reason: session.notice });
        session.notice = null;
      }
      if (session.pendingResult) {
        for (const frame of session.pendingResult) if (frame) sendSession(session, JSON.parse(frame), frame);
        session.pendingResult = null;
      }
      return;
    }
    const pendingResult = !room.match && !active ? session.pendingResult : null;
    session.notice = null;
    session.pendingResult = null;
    // a player seat, or a spectator seat (header): both carry `connected` / `name`
    const seat = room.seatOf(session.playerId) || room.spectatorOf(session.playerId);
    this.clearGrace(session.playerId);
    // Only a visible change (reconnect, rename, new host) is broadcast; a plain resync (repeated hello on a
    // live socket) answers the requester alone, so hello spam cannot amplify into room-wide traffic.
    let changed = !seat.connected;
    if(seat.avatarId !== session.avatarId){seat.avatarId=session.avatarId;changed=true;}
    if(seat.publicId !== session.publicId){seat.publicId=session.publicId;changed=true;}
    seat.connected = true;
    if (!room.match && seat.name !== session.name) { seat.name = session.name; changed = true; }
    if (!room.hostId) { this.migrateHost(room); changed = true; }
    if (changed) this.broadcastState(room);
    else this.sendState(room, session);
    this.resync(session, !resumed);
    if (pendingResult && !this.replayFor(room, session.playerId)) {
      for (const frame of pendingResult) if (frame) sendSession(session, JSON.parse(frame), frame);
    }
  }

  /**
   * Validated client message from an identified session. A room whose match runs in a match host handles its
   * messages one at a time, in order (serial; header "Gameplay plugins"): the answer is then a Promise (server/net.js
   * replies when it settles).
   * @param {import('./net.js').Session} session
   * @param {any} msg
   * @returns {{ ok: true } | { error: string, detail?: string } | Promise<{ ok: true } | { error: string, detail?: string }>}
   */
  onMessage(session, msg) {
    // Review outside the room queue; only a verdict still bound to this session may enter it.
    if (typeof msg?.t === 'string' && msg.t.startsWith('g.')) return this.routeGame(session, msg);
    const room = this.queuedRoom(session);
    if (!room) return this.handleMessage(session, msg);
    // a queued room.contentReady speaks for the page that sent it: the seat and its generation now — a disconnect in
    // between bumps it, and the page that comes back checks the set again (contentReady)
    const ctx = msg && msg.t === 'room.contentReady' ? { from: this.seatGen(room, session.playerId) } : null;
    return this.serial(room, () => this.handleMessage(session, msg, ctx));
  }

  /** A seat (or spectator seat) of `room` and its content generation (header "Gameplay plugins"), or null. */
  seatGen(room, playerId) {
    const seat = room.seatOf(playerId) || room.spectatorOf(playerId);
    return seat ? { seat, gen: seat.contentGen || 0 } : null;
  }

  /**
   * The room of `session` when its messages go through the room's queue: its match runs in a match host
   * (MatchProxy `hosted`), or something of the room is still pending. Null for every vanilla room.
   * @param {import('./net.js').Session} session
   */
  queuedRoom(session) {
    const room = session.roomCode ? this.rooms.get(session.roomCode) : null;
    return room && !room.disposed && (room.queue.pending > 0 || room.match?.hosted === true) ? room : null;
  }

  /**
   * Run `fn` on the room's queue (header "Gameplay plugins"): at once when nothing of the room is pending — a synchronous
   * answer stays synchronous —, else after everything before it has settled. An answer that is a Promise keeps the room's
   * queue busy until it settles.
   * @template T
   * @param {Room} room @param {() => T} fn
   * @returns {T | Promise<Awaited<T>>}
   */
  serial(room, fn) {
    const q = room.queue;
    if (q.pending === 0) {
      const r = fn();
      if (!r || typeof /** @type {any} */ (r).then !== 'function') return r;
      q.pending++;
      const done = Promise.resolve(r).finally(() => { q.pending--; });
      q.tail = done.then(() => {}, () => {});
      return /** @type {any} */ (done);
    }
    q.pending++;
    const done = q.tail.then(() => fn()).finally(() => { q.pending--; });
    q.tail = done.then(() => {}, () => {});
    return /** @type {any} */ (done);
  }

  /** An event of the room (a disconnect, a resync, an expiry) on its queue: nothing waits for it; a failure is logged. */
  queueEvent(room, fn) {
    let r;
    try { r = this.serial(room, fn); } catch (e) { this.log.error(`[lobby] ${room.code} a room event failed`, e); return; }
    if (r && typeof r.then === 'function') r.then(null, (e) => this.log.error(`[lobby] ${room.code} a room event failed`, e));
  }

  /**
   * One message (onMessage), now. `ctx`: what onMessage noted when it queued the message (a contentReady's seat
   * generation), else null.
   * @param {import('./net.js').Session} session
   * @param {any} msg
   * @param {{ from?: { seat: Seat, gen: number } | null } | null} [ctx]
   */
  handleMessage(session, msg, ctx = null) {
    switch (msg.t) {
      case 'state.resync': this.resync(session, true); return OK;
      case 'room.create': return this.create(session, msg);
      case 'room.join': return this.join(session, msg);
      case 'room.leave': return this.leave(session);
      case 'room.chat': case 'room.emote': return this.roomCommunication(session, msg);
      case 'room.ready': return this.ready(session, msg);
      case 'room.setOptions': return this.setOptions(session, msg);
      case 'room.setDifficulty': return this.setDifficulty(session, msg);
      case 'room.setAiPicksLast': return this.setAiPicksLast(session, msg);
      case 'room.setSoloUnlimited': return this.setSoloUnlimited(session, msg);
      case 'room.setAiTakeover': return this.setAiTakeover(session, msg);
      case 'room.aiRequest':
      case 'room.aiVote': return aiTakeover(this, session, msg);
      case 'room.addBot': return this.addBot(session);
      case 'room.removeBot': return this.removeBot(session, msg);
      case 'room.kick': return this.kick(session, msg);
      case 'room.start': return this.start(session);
      case 'room.console.enable': return this.enableConsole(session);
      case 'room.console.disable': return this.disableConsole(session);
      case 'room.rerollSetup': return this.rerollSetup(session, msg);
      case 'room.cancelReroll': return this.rerollSetup(session, msg, true);
      case 'room.loadout': return this.loadout(session, msg);
      case 'room.skins': return this.skins(session, msg);
      case 'room.card': return this.card(session, msg);
      case 'match.join': return this.matchJoin(session, msg);
      case 'match.leave': return this.matchLeave(session);
      case 'room.ownership': return this.ownership(session, msg);
      case 'room.diy': return this.diy(session, msg);
      case 'room.spectate': return this.spectate(session, msg);
      case 'room.removeSpectator': return this.removeSpectator(session, msg);
      case 'room.setPlugins': return this.setPlugins(session, msg);
      case 'room.setMode': return this.setMode(session, msg);
      case 'room.contentReady': return this.contentReady(session, msg, ctx);
      case 'room.consent': return this.consent(session,msg);
      case 'room.proposeVersion': return this.proposeVersion(session, msg);
      case 'room.versionVote': return this.versionVote(session, msg);
      case 'room.cancelVersionVote': return this.cancelVersionVote(session, msg);
      // A client that missed a state-delta frame asks for a full one (shared/stateDelta.js StateReceiver; server/net.js
      // throttles it like the other resend-heavy intents). This is the same heavy resync a repeated hello runs, so it
      // draws from the same per-session budget: the match resends its full state, or the lobby its room state.
      default:
        if (typeof msg.t === 'string' && msg.t.startsWith('g.')) return this.routeGameNow(session, msg);
        return fail(ERR.BAD_MSG, `unhandled type ${String(msg.t).slice(0, 32)}`);
    }
  }

  /** The session's socket closed. @param {import('./net.js').Session} session */
  onDisconnect(session) {
    if (this.hasActiveMatch(session)) session.lastMatchAt = this.now();
    this.clearResync(session.playerId); // the next resume resyncs immediately
    const queued = this.queueByPlayer.get(session.playerId);
    if (queued) this.cancelMatchQueue(queued, 'disconnect');
    const room = this.roomOf(session);
    // Solo matches are retained for 6 hours; everything else keeps the registry's window.
    session.resumeWindowMs = room && room.match && room.mode === 'solo' ? this.soloResumeWindowMs(room) : null;
    const active = this.activeMatchOf(session);
    if (!room && !active) return;
    if (!room && active) {
      this.callMatchContext(active, 'onDisconnect', session.playerId);
      return;
    }
    const player = room.seatOf(session.playerId);
    const seat = player || room.spectatorOf(session.playerId);
    if (!seat) return;
    seat.connected = false;
    // the page may come back as a new one (a reload): it loads and checks the room's content again (header "Gameplay
    // plugins") — and a room.contentReady of the page that went, still on the room's queue, no longer counts (seatGen)
    if (room.needsContent) seat.content = null;
    seat.contentGen = (seat.contentGen || 0) + 1;
    // a voter's socket dropped: the version vote is void (header "Official versions")
    if (player && room.versionVote?.voters.includes(session.playerId)) this.voidVersionVote(room, 'members');
    // a spectator's seat is kept like a player's (nothing to tell the match: it plays no field)
    if (active || room.match) { if (player) { if (room?.match?.hosted && this.queuedRoom(session)) this.queueEvent(room, () => { if (!session.connected) this.callMatchContext(active || room.matchCtx, 'onDisconnect', session.playerId); }); else this.callMatchContext(active || room.matchCtx, 'onDisconnect', session.playerId); }; }
    else this.startGrace(room, seat);
    this.broadcastState(room);
  }

  /** The session's reconnect window elapsed (already removed from the registry). */
  onExpire(session) {
    session.notice = null;
    session.pendingResult = null;
    this.clearResync(session.playerId);
    const queued = this.queueByPlayer.get(session.playerId);
    if (queued) this.cancelMatchQueue(queued, 'expired');
    const active = this.activeMatchOf(session);
    const roomCode = session.roomCode;
    if (active && !active.ended && (!roomCode || (active.queue && active.room?.code !== roomCode))) {
      this.leaveQueuedMatchPlayer(active, session.playerId);
    }
    const code = session.roomCode;
    const room = code ? this.rooms.get(code) : null;
    // in order with the room's messages when its match runs in a match host (header "Gameplay plugins")
    if (room && this.queuedRoom(session)) {
      this.queueEvent(room, () => { if (session.roomCode === code) session.roomCode = null; this.removeMember(room, session.playerId); });
      return;
    }
    session.roomCode = null;
    if (room) this.removeMember(room, session.playerId);
  }

  /**
   * Dispose every room (notifying members with room.closed) — used on server shutdown.
   * @param {string} [reason]
   */
  shutdown(reason = 'shutdown') {
    this.shuttingDown = true;
    this.stopMatchmaking();
    for (const entry of [...new Set(this.queueByPlayer.values())]) this.cancelMatchQueue(entry, reason);
    this.offStale?.();
    this.offContentStale?.();
    this.offStale = null;
    this.offContentStale = null;
    for (const room of [...this.rooms.values()]) this.disposeRoom(room, reason);
    for (const ctx of [...this.activeQueueMatches]) this.disposeMatchCtx(ctx);
    for (const t of this.graceTimers.values()) clearTimeout(t);
    this.graceTimers.clear();
    for (const t of this.resyncTimers.values()) clearTimeout(t);
    this.resyncTimers.clear();
  }

  stopMatchmaking() {
    if (this.matchQueueTimer) { clearInterval(this.matchQueueTimer); this.matchQueueTimer = null; }
  }

  // ---------------------------------------------------------------------------------------------------
  // restore (server/persist.js, docs/DEPLOY.md「断点续玩」)
  // ---------------------------------------------------------------------------------------------------

  /**
   * Rebuild the rooms of a persisted document. Seats whose session did not survive (or whose player had already left)
   * are dropped; a room without a human is restored only as a verified running queue container. Every restored seat
   * starts disconnected with a fresh lobby grace (the players are reconnecting right now).
   * @param {object[]} docs room documents (server/persist.js roomDoc)
   * @param {{ now?: number, allowEmpty?: boolean }} [opts] empty containers require a verified queue checkpoint
   * @returns {{ rooms: number, seats: number, droppedSeats: number }}
   */
  restoreRooms(docs, { now = this.now(), allowEmpty = false } = {}) {
    const stats = { rooms: 0, seats: 0, droppedSeats: 0 };
    for (const d of Array.isArray(docs) ? docs : []) {
      if (!d || typeof d.code !== 'string' || d.code.length !== ROOM_CODE_LEN || this.rooms.has(d.code)) { stats.droppedSeats++; continue; }
      const mode = d.mode === 'solo' ? 'solo' : 'coop';
      const difficulty = typeof d.difficulty === 'string' && d.difficulty ? d.difficulty : 'NORMAL';
      const room = new Room(d.code, mode, difficulty, now, d.version || DEFAULT_VERSION);
      room.ownerKey = typeof d.ownerKey === 'string' ? d.ownerKey : null;
      room.matchKey = typeof d.matchKey === 'string' ? d.matchKey : null;
      room.matchCount = Number.isInteger(d.matchCount) && d.matchCount >= 0 ? d.matchCount : 0;
      room.content = this.baseContent(room.version) || d.content || this.vanilla;
      room.test = d.test === true;
      room.aiTakeoverEnabled = d.aiTakeoverEnabled === true;
      room.soloUnlimited = d.soloUnlimited === true;
      if (!this.versions?.available(room.version) && room.version !== DEFAULT_VERSION) room.recoveryContentMissing = true;
      if (d.content?.plugins?.length) {
        const ids = d.content.plugins.filter(p => !p.auto).map(p => p.id);
        const settings = Object.fromEntries(d.content.plugins.filter(p => p.settings).map(p => [p.id, p.settings]));
        const r = this.resolveContent(room, ids, settings);
        if (r.content && (d.content.vanilla !== false || r.content.cs === d.content.cs)) {
          room.content = Object.freeze({ ...r.content, ...(d.content.modeId ? { modeId: d.content.modeId } : {}) });
          this.holdContent(room.content);
        } else {
          room.content = d.content;
          room.recoveryContentMissing = true;
          this.log.warn(`[persist] ${room.code}: saved plugin content unavailable; checkpoint retained`);
        }
      }
      room.consoleEnabled = d.consoleEnabled === true;
      room.prepSeconds = mode === 'coop' ? normalizePrepSeconds(d.prepSeconds) : null;
      room.prepMultiplier = mode === 'coop' ? normalizePrepMultiplier(d.prepMultiplier) : null;
      room.battleSpeed = normalizeBattleSpeed(d.battleSpeed);
      room.aiPicksLast = mode !== 'solo' && d.aiPicksLast === true;
      for (const s of Array.isArray(d.seats) ? d.seats : []) {
        if (!s || typeof s.playerId !== 'string' || !Number.isInteger(s.seat) || s.seat < 0 || s.seat >= MAX_SEATS || room.seats[s.seat]) continue;
        const isBot = !!s.isBot;
        const left = !!s.left;
        const session = isBot ? null : this.registry.byId(s.playerId);
        if (!isBot && !left && !session) { stats.droppedSeats++; continue; }
        room.seats[s.seat] = {
          seat: s.seat,
          playerId: s.playerId,
          name: session?.name || (typeof s.name === 'string' && s.name ? s.name : t('博士')),
          avatarId: session?.avatarId || s.avatarId || null,
          publicId: session?.publicId || s.publicId || null,
          isBot,
          ready: !!s.ready,
          connected: false,
          left,
          skins: isBot ? null : (session?.skins || s.skins || null),
          card: isBot || !(session?.card ?? s.card) ? null : cleanPlayerCard(session?.card ?? s.card, (id) => opsCharIds(this.safeData()).has(id)),
          loadout: isBot ? null : (session?.loadout || (s.loadout && typeof s.loadout === 'object' ? s.loadout : null)),
          loadoutCs: isBot ? null : session?.loadoutCs ?? s.loadoutCs ?? null,
          notOwnedCs: isBot ? null : session?.notOwnedCs ?? s.notOwnedCs ?? null,
          diyCs: isBot ? null : session?.diyCs ?? s.diyCs ?? null,
          ops: isBot ? null : session?.ops || s.ops || null,
          notOwned: isBot ? null : session?.notOwned || s.notOwned || null,
          diy: isBot ? null : session?.diy || s.diy || null,
        };
        stats.seats++;
      }
      if (room.activeHumans().length === 0 && !allowEmpty) { stats.droppedSeats += room.seats.filter(Boolean).length; continue; }
      const host = room.seatOf(d.hostId);
      room.hostId = host && !host.isBot && !host.left ? d.hostId : null;
      if (!room.hostId) this.migrateHost(room);
      this.rooms.set(room.code, room);
      stats.rooms++;
      for (const s of room.seats) if (s && !s.isBot && !s.left && !s.connected) this.startGrace(room, s);
    }
    if (stats.rooms) this.log.info(`[lobby] restored ${stats.rooms} room(s), ${stats.seats} seat(s)${stats.droppedSeats ? `, ${stats.droppedSeats} seat(s) dropped` : ''}`);
    return stats;
  }

  /**
   * Rebuild a running match. Public queue guests belong to its match context, rather than the owning room's seats.
   * Missing or conflicting identities leave the restored match; remaining humans keep their checkpoint.
   * @param {Room} room @param {object} checkpoint
   * @returns {boolean} true when the match runs again
   */
  restoreMatch(room, checkpoint, { queue = false, departedPlayerIds = [], sessionMatchKeys = null } = {}) {
    if (!room || room.disposed || room.match || !checkpoint || typeof checkpoint !== 'object') return false;
    const prepared = this.prepareRecovery(checkpoint, { room, departedPlayerIds, sessionMatchKeys });
    if (!prepared) return false;
    const { doc, departed } = prepared;
    // Older documents have no queueMatch flag; a human outside the room can only be a matched public guest.
    if (queue || doc.players.some((p) => !p.isBot && !departed.has(p.playerId) && !room.seatOf(p.playerId))) {
      return this.restoreQueuedMatch(doc, { room, departedPlayerIds: [...departed], sessionMatchKeys });
    }
    const res = this.startMatchWith(room, room.matchKey, doc, { departedPlayerIds: [...departed] });
    if (res && typeof res.then === 'function') return res.then((value) => !(value && value.error));
    if (res && res.error) return false;
    return true;
  }

  /** Salvage independently valid seats without inventing a human identity or binding it to two games. */
  prepareRecovery(checkpoint, { room = null, departedPlayerIds = [], sessionMatchKeys = null } = {}) {
    const key = room?.code || `queue:${checkpoint.roomCode || '?'}`;
    const warn = (reason) => this.log.warn(`[persist] ${key}: recovery ${reason}`);
    const departed = new Set(departedPlayerIds);
    const ids = new Set(), seats = new Set(), players = [];
    let humans = 0;
    for (const p of Array.isArray(checkpoint.players) ? checkpoint.players : []) {
      if (!p || typeof p.playerId !== 'string' || !p.playerId || ids.has(p.playerId) || players.length >= MAX_SEATS) {
        warn('skipped an invalid, duplicate or excess player record');
        continue;
      }
      ids.add(p.playerId);
      let seat = Number.isInteger(p.seat) && p.seat >= 0 && p.seat < MAX_SEATS && !seats.has(p.seat) ? p.seat : -1;
      if (seat < 0) {
        seat = Array.from({ length: MAX_SEATS }, (_, i) => i).find((i) => !seats.has(i));
        warn(`reassigned invalid seat for ${p.playerId} to ${seat}`);
      }
      seats.add(seat);
      const isBot = p.isBot === true || (p.isBot == null && p.playerId.startsWith('ai_'));
      if (p.left || room?.seatOf(p.playerId)?.left) departed.add(p.playerId);
      if (!isBot && !departed.has(p.playerId)) {
        const session = this.registry.byId(p.playerId);
        const owner = sessionMatchKeys?.get(p.playerId);
        if (!session || (owner && owner !== key) || (!room && session.roomCode) || this.activeMatchOf(session)) {
          departed.add(p.playerId);
          warn(`${!session ? 'missing session' : 'conflicting ownership'} for human seat ${p.playerId}; continuing with remaining humans`);
        } else humans++;
      }
      players.push({ ...p, seat, isBot });
    }
    if (!humans) { warn('deferred: no remaining human with a usable session'); return null; }
    if (room) {
      for (const id of departed) {
        const seat = room.seatOf(id);
        if (seat) { seat.left = true; seat.connected = false; }
      }
      if (room.seatOf(room.hostId)?.left) this.migrateHost(room);
    }
    const mode = checkpoint.mode === 'solo' ? 'solo' : 'coop';
    const difficulty = DIFFICULTIES.includes(checkpoint.difficulty) ? checkpoint.difficulty : room?.difficulty || 'NORMAL';
    const modeId = checkpoint.requireCs && room?.modded ? room.content?.modeId || modeIdFor(mode, difficulty) : modeIdFor(mode, difficulty);
    return { doc: { ...checkpoint, mode, difficulty, modeId, players }, departed };
  }

  /** Active matches exposed to the persistence layer. Queue matches without a room have no Room to enumerate. */
  persistenceMatches() {
    const out = [];
    const seen = new Set();
    for (const room of this.rooms.values()) {
      if (!room.match || room.disposed) continue;
      const ctx = room.matchCtx;
      seen.add(ctx);
      out.push({ key: room.code, room, ctx, match: room.match });
    }
    for (const ctx of this.activeQueueMatches) {
      if (!ctx || ctx.disposed || ctx.ended || ctx.room || !ctx.match || seen.has(ctx)) continue;
      const key = `queue:${ctx.match.roomCode}`;
      out.push({ key, room: null, ctx, match: ctx.match });
    }
    return out;
  }

  /** Rebuild either kind of matchmaking context, excluding departed humans from session ownership. */
  restoreQueuedMatch(checkpoint, { room = null, departedPlayerIds = [], sessionMatchKeys = null } = {}) {
    if (!checkpoint || typeof checkpoint !== 'object') return false;
    const prepared = this.prepareRecovery(checkpoint, { room, departedPlayerIds, sessionMatchKeys });
    if (!prepared) return false;
    const { doc, departed } = prepared;
    if (this.matchWorkerPool) return this.restoreQueuedMatchWorker(doc, { room, departedPlayerIds: [...departed], sessionMatchKeys });
    checkpoint = doc;
    const players = doc.players;
    const seats = players.map((p, i) => ({
      seat: Number.isInteger(p.seat) && p.seat >= 0 && p.seat < MAX_SEATS ? p.seat : i,
      playerId: p.playerId,
      name: typeof p.name === 'string' ? p.name : t('博士'),
      isBot: !!p.isBot,
      left: !p.isBot && departed.has(p.playerId),
      connected: false,
      skins: p.isBot ? null : p.skins || null, loadout: p.isBot ? null : (p.loadout || null), ops: p.isBot ? null : p.ops || null, notOwned: p.isBot ? null : p.standIns || null, diy: p.isBot ? null : p.diy || null,
    }));
    if (!checkpoint) for (const seat of seats) if (!seat.isBot) Object.assign(seat, this.seatSettings(room, room.seatOf(seat.playerId), this.dataFor(room)));
    const ctx = { live: false, ended: false, disposed: false, queue: true, match: null, room,
      members: seats, lastPublic: null, sharedResult: null, results: new Map(), profileUsers:Object.fromEntries(seats.map(s=>[s.playerId,s.userId || this.registry.byId(s.playerId)?.userId || null])) };
    const roomCode = typeof checkpoint.roomCode === 'string' && checkpoint.roomCode ? checkpoint.roomCode : `M${randomBytes(3).toString('hex').toUpperCase()}`;
    const mode = checkpoint.mode === 'solo' ? 'solo' : 'coop';
    const difficulty = typeof checkpoint.difficulty === 'string' && checkpoint.difficulty ? checkpoint.difficulty : 'NORMAL';
    try {
      const match = new this.MatchClass({
        userPersistence:!!this.users, replayMaxBytes:this.replayMaxBytes || 0, roomCode, mode, difficulty, modeId: modeIdFor(mode, difficulty), seats,
        consoleEnabled: false, aiPicksLast: !!checkpoint.aiPicksLast, seed: Number(checkpoint.seed) >>> 0, matchNo: room ? Math.max(1, room.matchCount) : 1,
        data: this.safeData(), workerPool: this.workerPoolFor(room?.code || roomCode), log: this.log, now: this.now,
        send: (playerId, msg, encoded) => (ctx.live ? this.queueMatchSend(ctx, playerId, msg, encoded) : false),
        broadcast: (msg, encoded) => { if (ctx.live) this.queueMatchBroadcast(ctx, msg, encoded); },
        onEnd: (summary) => this.onQueuedMatchEnd(ctx, summary),
      });
      ctx.match = match;
      if (!applyMatchCheckpoint(match, checkpoint, { createRngFromState, log: this.log, bestEffort: true, departedPlayerIds: [...departed] })) {
        this.disposeMatchCtx(ctx);
        return false;
      }
      ctx.live = true;
      this.activeQueueMatches.add(ctx);
      if (room) {
        room.match = match;
        room.matchCtx = ctx;
        room.replay = null;
      }
      for (const p of seats) if (!p.isBot && !p.left) {
        const session = this.registry.byId(p.playerId);
        if (session) session.activeMatchCtx = ctx;
      }
      if (this.completeRecoveredMatch(ctx, room)) return true;
      match._lastPubJson = '';
      match.flush?.(true);
      if (room && !room.disposed) this.broadcastState(room);
      return true;
    } catch (e) {
      this.log.error(`[match] ${roomCode} matchmaking restore failed`, e);
      if (room?.matchCtx === ctx) { room.match = null; room.matchCtx = null; }
      this.disposeMatchCtx(ctx);
      return false;
    }
  }

  async restoreQueuedMatchWorker(checkpoint, { room = null, departedPlayerIds = [], sessionMatchKeys = null } = {}) {
    const players = checkpoint.players;
    const seats = players.map((p, i) => ({
      seat: Number.isInteger(p.seat) && p.seat >= 0 && p.seat < MAX_SEATS ? p.seat : i,
      playerId: p.playerId, name: typeof p.name === 'string' ? p.name : t('博士'), isBot: !!p.isBot,
      left: !p.isBot && departedPlayerIds.includes(p.playerId), connected: false,
      skins: p.isBot ? null : p.skins || null, loadout: p.isBot ? null : (p.loadout || null), ops: p.isBot ? null : p.ops || null, notOwned: p.isBot ? null : p.standIns || null, diy: p.isBot ? null : p.diy || null,
    }));
    const roomCode = typeof checkpoint.roomCode === 'string' && checkpoint.roomCode
      ? checkpoint.roomCode : `M${randomBytes(3).toString('hex').toUpperCase()}`;
    const mode = checkpoint.mode === 'solo' ? 'solo' : 'coop';
    const difficulty = typeof checkpoint.difficulty === 'string' && checkpoint.difficulty ? checkpoint.difficulty : 'NORMAL';
    const ctx = { live: false, ended: false, disposed: false, queue: true, match: null, workerKey: roomCode, room,
      members: seats, lastPublic: null, sharedResult: null, results: new Map(), profileUsers:Object.fromEntries(seats.map(s=>[s.playerId,s.userId || this.registry.byId(s.playerId)?.userId || null])) };
    try {
      const match = await this.matchWorkerPool.create(roomCode, {
        userPersistence:!!this.users, replayMaxBytes:this.replayMaxBytes || 0, roomCode, mode, difficulty, modeId: modeIdFor(mode, difficulty), seats, consoleEnabled: false, aiPicksLast: !!checkpoint.aiPicksLast,
        seed: Number(checkpoint.seed) >>> 0, matchNo: room ? Math.max(1, room.matchCount) : 1,
      }, {
        created: (match) => this.attachQueuedWorker(ctx, room, match),
        send: (playerId, msg, encoded) => { if (ctx.live) return this.queueMatchSend(ctx, playerId, msg, encoded); return false; },
        broadcast: (msg, encoded) => { if (ctx.live) this.queueMatchBroadcast(ctx, msg, encoded); },
        end: (summary) => this.onQueuedMatchEnd(ctx, summary),
      }, checkpoint, departedPlayerIds);
      if (ctx.disposed || room?.disposed || (room && room.matchCtx !== ctx)) {
        await match.dispose();
        return false;
      }
      if (room) room.replay = null;
      if (this.completeRecoveredMatch(ctx, room)) return true;
      await match.invoke('flush', true);
      if (room && !room.disposed) this.broadcastState(room);
      return true;
    } catch (e) {
      this.log.error(`[match] ${roomCode} matchmaking Worker restore failed`, e);
      if (room?.matchCtx === ctx) { room.match = null; room.matchCtx = null; room.matchKey = null; }
      this.disposeMatchCtx(ctx);
      return false;
    }
  }

  /** If partial recovery legitimately finishes the game, preserve its settlement for reconnecting humans. */
  completeRecoveredMatch(ctx, room) {
    const match = ctx.match;
    if (!match?.ended) return false;
    ctx.lastPublic = encode(match.publicView());
    for (const p of match.order) if (!p.isBot && !p.left) {
      const session = this.registry.byId(p.playerId);
      const result = match.lastResultMsg ? encode({ ...match.lastResultMsg, playerId: p.playerId }) : null;
      if (result) ctx.results.set(p.playerId, result);
      if (session) session.pendingResult = [ctx.lastPublic, result].filter(Boolean);
    }
    if (ctx.queue) this.onQueuedMatchEnd(ctx, match.lastResultMsg);
    else this.onMatchEnd(room, ctx, match.lastResultMsg);
    return true;
  }

  // ---------------------------------------------------------------------------------------------------
  // room.* handlers
  // ---------------------------------------------------------------------------------------------------

  /**
   * Join the shared matchmaking pool. A player outside a room contributes one seat; a room host contributes the
   * whole connected human party. All tickets may combine; only a full human team starts, without an AI timeout.
   * Legacy clients may still send `fillBots`, but it no longer affects matchmaking.
   */
  matchJoin(session, { mode, difficulty }) {
    const room = this.roomOf(session);
    const active = this.activeMatchOf(session);
    if (active) return fail(ERR.ROOM_STARTED, 'match already running');
    if (this.queueByPlayer.has(session.playerId)) return fail(ERR.MATCHING);
    if (mode === 'solo') {
      if (room) return fail(ERR.MATCHING, 'leave the room before solo matchmaking');
      // Compatibility for clients from the first queue rollout. The current UI keeps independent simulation on its
      // solo room path and only sends mode=coop from the in-room teammate-match option.
      const entry = this.makeQueueEntry({ mode: 'coop', difficulty, room: null,
        players: [{ ...this.humanSeat(0, session), connected: session.connected }] });
      this.enqueueMatchEntry(entry);
      this.processMatchQueues();
      return OK;
    }
    if (room) {
      if (room.match || room.matching) return fail(room.match ? ERR.ROOM_STARTED : ERR.MATCHING);
      if (room.mode !== 'coop') return fail(ERR.BAD_MSG, 'solo rooms cannot join co-op matchmaking');
      if (room.consoleEnabled) return fail(ERR.MATCHING, 'console and matchmaking are mutually exclusive');
      if (room.prepSeconds != null || room.prepMultiplier != null || room.battleSpeed !== 2) return fail(ERR.MATCHING, 'custom preparation time cannot join public matchmaking');
      if (room.modded || room.recoveryContentMissing) return fail(ERR.MATCHING, t('插件房间不能参加公共匹配'));
      if (room.hostId !== session.playerId) return fail(ERR.NOT_HOST);
      if (room.seats.some((s) => s?.isBot)) return fail(ERR.BAD_MSG, t('请先移除 AI 队友，再匹配真人队友'));
      const humans = room.activeHumans();
      if (this.accountSeatConflict(humans)) return fail(ERR.ACCOUNT_ACTIVE);
      if (!humans.length || humans.some((s) => !s.connected)) return fail(ERR.NOT_READY, 'all party members must be connected');
      if (humans.some((s) => this.queueByPlayer.has(s.playerId))) return fail(ERR.MATCHING);
      const players = humans.map((s) => ({ seat: s.seat, playerId: s.playerId, name: s.name,
        isBot: false, connected: true, skins: s.skins || null, loadout: s.loadout || null, ops: s.ops || null,
        notOwned: s.notOwned || null, diy: s.diy || null }));
      const entry = this.makeQueueEntry({ mode, difficulty: room.difficulty, room, players });
      this.enqueueMatchEntry(entry);
      this.broadcastState(room);
      this.processMatchQueues();
      return OK;
    }
    const entry = this.makeQueueEntry({ mode, difficulty, room: null,
      players: [{ ...this.humanSeat(0, session), connected: session.connected }] });
    this.enqueueMatchEntry(entry);
    this.processMatchQueues();
    return OK;
  }

  matchLeave(session) {
    const entry = this.queueByPlayer.get(session.playerId);
    if (!entry) return fail(ERR.NOT_MATCHING);
    this.cancelMatchQueue(entry, 'cancelled');
    return OK;
  }

  makeQueueEntry({ mode, difficulty, room, players }) {
    const now = this.now();
    const entry = {
      queueId: `Q${(++this.queueSeq).toString(36).toUpperCase()}`,
      mode, difficulty, room: room || null, players: players.map((p) => ({ ...p })),
      queuedAt: now,
      removed: false,
    };
    return entry;
  }

  enqueueMatchEntry(entry) {
    const key = `${entry.mode}:${entry.difficulty}`;
    const bucket = this.matchQueues.get(key) || [];
    bucket.push(entry);
    this.matchQueues.set(key, bucket);
    for (const p of entry.players) if (!p.isBot) {
      const session = this.registry.byId(p.playerId);
      if (session) session.matchQueue = entry;
      this.queueByPlayer.set(p.playerId, entry);
    }
    if (entry.room) {
      entry.room.matching = { queueId: entry.queueId, queuedAt: entry.queuedAt, count: entry.players.length, capacity: MAX_SEATS };
    }
    this.broadcastQueueCounts(entry.mode, entry.difficulty);
  }

  /** Oldest-first party packing without splitting parties. Legacy AI flags are ignored. */
  selectMatchEntries(bucket) {
    const first = bucket[0];
    const selected = [first];
    let total = first.players.length;
    for (let i = 1; i < bucket.length && total < MAX_SEATS; i++) {
      const next = bucket[i];
      if (!next || next.removed || total + next.players.length > MAX_SEATS) continue;
      if (this.accountSeatConflict([...selected.flatMap((entry) => entry.players), ...next.players])) continue;
      selected.push(next);
      total += next.players.length;
    }
    return selected;
  }

  /** Use identical groups for counts and match launch. */
  groupMatchEntries(bucket) {
    const remaining = bucket.filter((entry) => entry && !entry.removed);
    const seen = new Set();
    let repeated = false;
    const accounts = remaining.map((entry) => entry.players.filter((p) => !p.isBot)
      .map((p) => this.registry?.byId(p.playerId)?.userId).filter(Boolean));
    for (const ids of accounts) for (const id of ids) {
      if (seen.has(id)) repeated = true;
      seen.add(id);
    }
    if (repeated) return this.groupDistinctAccountEntries(remaining, accounts);
    const groups = [];
    // At most four seats: keep FIFO candidates by party size, then choose the
    // earliest party that fits. Each candidate is visited once; packing is unchanged.
    const bySize = Array.from({ length: MAX_SEATS + 1 }, () => []);
    const heads = new Uint32Array(MAX_SEATS + 1);
    const used = new Set();
    for (let i = 0; i < remaining.length; i++) {
      const entry = remaining[i];
      if (entry.players.length > 0 && entry.players.length <= MAX_SEATS) bySize[entry.players.length].push(i);
    }
    for (let i = 0; i < remaining.length; i++) {
      if (used.has(i)) continue;
      const first = remaining[i];
      const selected = [first];
      used.add(i);
      let total = first.players.length;
      while (total < MAX_SEATS) {
        let next = Infinity;
        for (let size = 1; size <= MAX_SEATS - total; size++) {
          const candidates = bySize[size];
          while (heads[size] < candidates.length && used.has(candidates[heads[size]])) heads[size]++;
          if (heads[size] < candidates.length) next = Math.min(next, candidates[heads[size]]);
        }
        if (next === Infinity) break;
        used.add(next);
        selected.push(remaining[next]);
        total += remaining[next].players.length;
      }
      groups.push(selected);
    }
    return groups;
  }

  /** Same FIFO packing when a profile has several tickets, excluding its other tickets from each group.
   * Bitsets skip all conflicting tickets together, so many tabs of one account do not cause quadratic rescans.
   * Account identifiers stay here in the lobby; neither tickets nor public counts contain them.
   */
  groupDistinctAccountEntries(entries, accounts) {
    const available = Array(MAX_SEATS + 1).fill(0n), byAccount = new Map();
    const bits = entries.map((entry, i) => {
      const bit = 1n << BigInt(i), size = entry.players.length;
      if (size > 0 && size <= MAX_SEATS) available[size] |= bit;
      for (const id of accounts[i]) byAccount.set(id, (byAccount.get(id) || 0n) | bit);
      return bit;
    });
    const groups = [];
    for (let i = 0; i < entries.length; i++) {
      if (!(available[entries[i].players.length] & bits[i])) continue;
      const selected = [];
      let next = i, total = 0, blocked = 0n;
      while (next < entries.length) {
        const entry = entries[next];
        selected.push(entry);
        total += entry.players.length;
        available[entry.players.length] &= ~bits[next];
        for (const id of accounts[next]) blocked |= byAccount.get(id);
        let candidates = 0n;
        for (let size = 1; size <= MAX_SEATS - total; size++) candidates |= available[size];
        candidates &= ~blocked;
        if (!candidates) break;
        // The least significant set bit is the earliest compatible ticket.
        next = (candidates & -candidates).toString(2).length - 1;
      }
      groups.push(selected);
    }
    return groups;
  }

  /** Send each ticket the waiting human count of its actual four-seat group. */
  broadcastQueueCounts(mode, difficulty, groups = null) {
    const bucket = this.matchQueues.get(`${mode}:${difficulty}`) || [];
    for (const group of groups || this.groupMatchEntries(bucket)) {
      const count = group.reduce((n, entry) => n + entry.players.filter((p) => !p.isBot).length, 0);
      for (const entry of group) {
        this.sendQueueState(entry, 'queued', null, count);
        if (entry.room?.matching && entry.room.matching.count !== count) {
          entry.room.matching.count = count;
          this.broadcastState(entry.room);
        }
      }
    }
  }

  /** Full human teams start immediately. Incomplete groups keep waiting without blocking later full groups. */
  processMatchQueues() {
    for (const [key, bucket] of this.matchQueues) {
      for (let i = bucket.length - 1; i >= 0; i--) {
        if (!bucket[i] || bucket[i].removed) bucket.splice(i, 1);
      }
      for (const selected of this.groupMatchEntries(bucket)) {
        const first = selected[0];
        const total = selected.reduce((n, entry) => n + entry.players.length, 0);
        if (total < MAX_SEATS) continue;
        for (const entry of selected) {
          this.removeQueueReferences(entry);
        }
        const players = selected.flatMap((entry) => entry.players.map((p) => ({ ...p })));
        const owner = selected.find((entry) => entry.room) || first;
        Promise.resolve(this.startQueuedMatch(owner, players, selected)).then((result) => {
          if (result?.error) this.failedQueuedStart(selected);
        }).catch((e) => {
          this.log.error(`[match] queued start failed: ${e?.message || e}`);
          this.failedQueuedStart(selected);
        });
      }
      const waiting = bucket.filter((entry) => !entry.removed);
      if (waiting.length !== bucket.length) {
        this.matchQueues.set(key, waiting);
        const [mode, difficulty] = key.split(':');
        this.broadcastQueueCounts(mode, difficulty);
      }
      if (!waiting.length) this.matchQueues.delete(key);
    }
  }

  /** A rejected async launch must clear the client's old queue UI, without cancelling a newer ticket/game. */
  failedQueuedStart(entries) {
    for (const entry of entries) {
      const players = entry.players.filter((p) => {
        const session = this.registry.byId(p.playerId);
        return !p.isBot && session && !this.activeMatchOf(session) && !session.matchQueue;
      });
      if (players.length) this.sendQueueState({ ...entry, players }, 'closed', 'start_failed');
      if (entry.room && !entry.room.disposed && !entry.room.match) this.broadcastState(entry.room);
    }
  }

  removeQueueReferences(entry) {
    if (!entry || entry.removed) return;
    entry.removed = true;
    for (const p of entry.players) if (!p.isBot) {
      if (this.queueByPlayer.get(p.playerId) === entry) this.queueByPlayer.delete(p.playerId);
      const session = this.registry.byId(p.playerId);
      if (session?.matchQueue === entry) session.matchQueue = null;
    }
    if (entry.room && entry.room.matching?.queueId === entry.queueId) entry.room.matching = null;
  }

  cancelMatchQueue(entry, reason = 'cancelled') {
    if (!entry || entry.removed) return;
    const bucket = this.matchQueues.get(`${entry.mode}:${entry.difficulty}`);
    if (bucket) {
      const i = bucket.indexOf(entry);
      if (i >= 0) bucket.splice(i, 1);
      if (!bucket.length) this.matchQueues.delete(`${entry.mode}:${entry.difficulty}`);
    }
    this.removeQueueReferences(entry);
    this.sendQueueState(entry, reason === 'cancelled' ? 'cancelled' : 'closed', reason);
    this.broadcastQueueCounts(entry.mode, entry.difficulty);
    if (entry.room && !entry.room.disposed) this.broadcastState(entry.room);
  }

  sendQueueState(entry, status = 'queued', reason = null, count = entry.players.filter((p) => !p.isBot).length) {
    const msg = { t: 'match.queue', status, queueId: entry.queueId, mode: entry.mode, difficulty: entry.difficulty,
      count, capacity: MAX_SEATS, queuedAt: entry.queuedAt,
      ...(reason ? { reason } : {}) };
    for (const p of entry.players) if (!p.isBot) {
      const session = this.registry.byId(p.playerId);
      if (session?.connected) sendSession(session, msg);
    }
  }

  create(session, { mode, difficulty: asked, test, version: askedVersion, soloUnlimited, prepSeconds = null, prepMultiplier = null, battleSpeed = 2 } = {}) {
    // A test room exists only when the process switch allowed it. The check runs before the room is built.
    if (test === true && this.testEnabled !== true) return fail(ERR.TEST_DISABLED);
    // the official version (header "Official versions"): left out, the server's default
    const version = askedVersion ?? this.defaultVersion();
    if (!this.versionEnabled(version)) return fail(ERR.VERSION_UNKNOWN);
    if (!this.offered(version, mode).length) return fail(ERR.VERSION_UNSUPPORTED, `${version} has no ${mode} rooms`);
    if (!this.versionAvailable(version)) return fail(ERR.VERSION_UNSUPPORTED, 'the data of this version is not available');
    // left out: the default (header); the protocol refuses any other value that is not a difficulty; one the version
    // lacks is lowered (终极 → 绝境)
    const difficulty = this.fallbackDifficulty(version, mode, DIFFICULTIES.includes(asked) ? asked : DEFAULT_DIFFICULTY);
    if (!isBattleSpeed(battleSpeed) || !isPrepSeconds(prepSeconds) || !isPrepMultiplier(prepMultiplier) || (prepSeconds != null && prepMultiplier != null)) return fail(ERR.BAD_MSG, 'invalid preparation time');
    if (this.queueByPlayer.has(session.playerId)) return fail(ERR.MATCHING);
    const cur = this.roomOf(session);
    if (this.activeMatchOf(session)) return fail(ERR.ROOM_STARTED, 'leave your running match first');
    if (this.rooms.size >= this.opts.maxRooms) {
      // the global cap used to fail silently: a full server and a crash looked the same to the player (docs/DEPLOY.md §3.4)
      this.limitWarn(`room limit (${this.opts.maxRooms}) reached (global)`);
      return fail(ERR.INTERNAL, 'too many rooms');
    }
    const key = session.limitKey || null;
    // The room being left disappears with this create when the creator is its only human (a spectator is none).
    const leaving = !!cur && cur.activeHumans().length === 1 && !cur.spectatorOf(session.playerId);
    if (key && this.opts.maxRoomsPerAddr > 0) {
      if (this.countRooms((r) => r.ownerKey === key) - (leaving && cur.ownerKey === key ? 1 : 0) >= this.opts.maxRoomsPerAddr) {
        this.limitWarn(`room limit (${this.opts.maxRoomsPerAddr}) reached for ${session.addr}`);
        return fail(ERR.RATE, 'too many rooms from your network');
      }
    }
    // A fixed key (--room-code) can only belong to one room. This player's own room may hold it and can be left
    // below (then the key is free again); any other room — or a room this session only watches as a spectator —
    // keeps it, and the create is refused before anything is removed.
    const fixed = this.opts.roomCode || null;
    const fixedIsMine = !!fixed && !!cur && this.rooms.get(fixed) === cur;
    if (fixed) {
      const taken = this.rooms.get(fixed);
      const mine = cur && cur.seatOf(session.playerId);
      const onlyMe = mine && cur.activeHumans().length === 1;
      if (taken && !(taken === cur && onlyMe)) {
        return fail(ERR.ROOM_CODE_TAKEN, 'the fixed alliance key is in use');
      }
    }
    // Treat this sole-human room as yielding its key, but keep membership until all content/version checks pass.
    const code = this.genCode(fixedIsMine ? cur : null);
    if (!code) return fixed ? fail(ERR.ROOM_CODE_TAKEN, 'the fixed alliance key is in use')
      : fail(ERR.INTERNAL, 'no room code available');
    // the server owner's default plugins (plugins/config.json `default`; header "Gameplay plugins"): none — the original
    // game. On another official version (header "Official versions") gameplay plugins are refused: a server whose rooms
    // must play them (rooms: fixed) cannot make that version's room; otherwise the room starts without them. Resolved
    // before the creator leaves the old room (a refusal keeps them there), so a set that room alone holds counts as freed
    // (limits.maxSets), as when the room went first before M1
    let initial = this.baseContent(version);
    const defaults = this.plugins?.defaults?.() || [];
    if (defaults.length) {
      const r = this.resolveContent(null, defaults, {}, version, leaving ? cur.content : null);
      if ('error' in r) {
        const fixed = (() => { try { return this.plugins?.fixed?.() || null; } catch { return null; } })();
        if (fixed && fixed.length && version !== DEFAULT_VERSION) return fail(ERR.VERSION_UNSUPPORTED, `this server fixes every room's plugins (plugins/config.json rooms: fixed): ${r.error}`);
        this.warnOnce(`[lobby] the default plugins (${defaults.join(', ')}) cannot be applied${version !== DEFAULT_VERSION ? ` to ${version}` : ''}: ${r.error}${r.detail ? ` (${r.detail})` : ''}`);
      } else initial = r.content;
    }
    if (cur) this.removeMember(cur, session.playerId);
    const room = new Room(code, mode, difficulty, this.now(), version);
    room.test = test === true;
    room.prepSeconds = mode === 'coop' ? normalizePrepSeconds(prepSeconds) : null;
    room.prepMultiplier = mode === 'coop' ? normalizePrepMultiplier(prepMultiplier) : null;
    room.battleSpeed = normalizeBattleSpeed(battleSpeed);
    // 「不限时」 only on a solo room of a version whose solo is timed (header). Anywhere else the key is ignored, so a
    // stray true cannot change a default or co-op create.
    if (mode === 'solo' && soloUnlimited === true && this.versionSoloTimed(version)) room.soloUnlimited = true;
    room.content = initial;
    if (initial !== this.baseContent(version)) this.holdContent(initial);
    room.ownerKey = key;
    room.seats[0] = this.humanSeat(0, session, room);
    room.hostId = session.playerId;
    this.rooms.set(code, room);
    session.roomCode = code;
    session.notice = null;
    session.pendingResult = null;
    this.log.info(`[lobby] ${code} created (${mode}/${difficulty}${version !== DEFAULT_VERSION ? `, ${version}` : ''}${room.test ? ', test' : ''}) by ${session.name}`);
    this.broadcastState(room);
    return OK;
  }

  join(session, { code, testAck }) {
    if (this.queueByPlayer.has(session.playerId)) return fail(ERR.MATCHING);
    const norm = String(code).trim().toUpperCase();
    const room = norm.length === ROOM_CODE_LEN ? this.rooms.get(norm) : undefined;
    if (!room) return fail(ERR.ROOM_NOT_FOUND);
    if (room.test && testAck !== true) return fail(ERR.TEST_CONFIRM);
    const cur = this.roomOf(session);
    // idempotent for members; a spectator of this room goes on below: it may take a free player seat (header)
    if (cur === room && !room.spectatorOf(session.playerId)) { this.sendState(room, session); return OK; }
    if (this.accountSeatConflict([...room.activeHumans(), session])) return fail(ERR.ACCOUNT_ACTIVE);
    if (this.activeMatchOf(session)) return fail(ERR.ROOM_STARTED, 'leave your running match first');
    if (room.match) return fail(ERR.ROOM_STARTED);
    if (room.matching) return fail(ERR.MATCHING);
    if (room.mode === 'solo') return fail(ERR.ROOM_FULL, 'solo room');
    const idx = room.freeSeat();
    if (idx < 0) return fail(ERR.ROOM_FULL);
    // a human takes a player seat: the version vote is void (header "Official versions") — before the seat is taken, so
    // its toast reaches the members who saw the vote (a spectator sitting down too), never a joiner who did not
    if (room.versionVote) this.voidVersionVote(room, 'members');
    if (cur) this.removeMember(cur, session.playerId);
    room.seats[idx] = this.humanSeat(idx, session, room);
    session.roomCode = room.code;
    session.notice = null;
    session.pendingResult = null;
    if (!room.hostId) room.hostId = session.playerId;
    this.broadcastState(room);
    return OK;
  }

  leave(session) {
    const queued = this.queueByPlayer.get(session.playerId);
    if (queued) {
      this.cancelMatchQueue(queued, 'cancelled');
      if (queued.room) this.removeMember(queued.room, session.playerId);
      return OK;
    }
    const room = this.roomOf(session);
    if (!room) return fail(ERR.NOT_IN_ROOM);
    this.removeMember(room, session.playerId);
    return OK;
  }

  /**
   * room.spectate: one of a co-op room's MAX_SPECTATORS spectator seats, in its lobby or during its match (header). In a
   * running match the match registers the spectator and resends what it may see (Match.addSpectator).
   */
  spectate(session, { code, testAck }) {
    const norm = String(code).trim().toUpperCase();
    const room = norm.length === ROOM_CODE_LEN ? this.rooms.get(norm) : undefined;
    if (!room) return fail(ERR.ROOM_NOT_FOUND);
    if (room.test && testAck !== true) return fail(ERR.TEST_CONFIRM);
    const cur = this.roomOf(session);
    if (cur === room) {
      if (!room.spectatorOf(session.playerId)) return this.becomeSpectator(room, session);
      this.sendState(room, session);
      return OK;
    }
    if (this.queueByPlayer.has(session.playerId)) return fail(ERR.MATCHING);
    if (this.activeMatchOf(session)) return fail(ERR.ROOM_STARTED, 'leave your running match first');
    if (room.mode === 'solo') return fail(ERR.ROOM_FULL, 'solo room');
    if (room.spectators.length >= MAX_SPECTATORS) return fail(ERR.ROOM_FULL, 'no free spectator seat');
    if (cur) this.removeMember(cur, session.playerId);
    room.spectators.push({ playerId: session.playerId, name: session.name, connected: session.connected });
    session.roomCode = room.code;
    session.notice = null;
    session.pendingResult = null;
    this.broadcastState(room);
    if (room.match) this.callMatch(room, 'addSpectator', session.playerId);
    return OK;
  }

  /** Change roles atomically before a match; spectators never keep a room alive or own its host role. */
  becomeSpectator(room, session) {
    if (room.match) return fail(ERR.ROOM_STARTED);
    if (room.matching || this.queueByPlayer.has(session.playerId)) return fail(ERR.MATCHING);
    if (room.mode === 'solo') return fail(ERR.ROOM_FULL, 'solo room');
    if (room.spectators.length >= MAX_SPECTATORS) return fail(ERR.ROOM_FULL, 'no free spectator seat');
    const seat = room.seatOf(session.playerId);
    if (!seat || seat.left || seat.isBot) return fail(ERR.NOT_IN_ROOM);
    if (!room.activeHumans().some(p => p.playerId !== session.playerId)) return fail(ERR.NOT_READY, 'at least one player must remain seated');
    this.clearGrace(session.playerId);
    this.dropReplay(room, session.playerId);
    room.seats[seat.seat] = null;
    room.spectators.push({ playerId: session.playerId, name: session.name, connected: session.connected });
    session.notice = null;
    session.pendingResult = null;
    if (room.hostId === session.playerId) this.migrateHost(room);
    this.broadcastState(room);
    return OK;
  }

  /** room.removeSpectator (host, any time): the spectator gets room.closed {kicked} and its seat is freed. */
  removeSpectator(session, { playerId }) {
    const room = this.roomOf(session);
    if (!room) return fail(ERR.NOT_IN_ROOM);
    if (room.hostId !== session.playerId) return fail(ERR.NOT_HOST);
    if (!room.spectatorOf(playerId)) return fail(ERR.BAD_TARGET, 'not a spectator of this room');
    const target = this.registry.byId(playerId);
    const wasHere = !!target && target.roomCode === room.code;
    const replay = this.replayFor(room, playerId);
    this.removeMember(room, playerId);
    if (wasHere) {
      // like room.kick: now, or on the next resume (with the result replay, as after the grace timeout)
      if (target.connected) sendSession(target, { t: 'room.closed', reason: 'kicked' });
      else { target.notice = 'kicked'; target.pendingResult = replay; }
    }
    return OK;
  }

  ready(session, { ready }) {
    const room = this.roomOf(session);
    if (!room) return fail(ERR.NOT_IN_ROOM);
    if (room.spectatorOf(session.playerId)) return fail(ERR.SPECTATOR);
    if (room.match) return fail(ERR.ROOM_STARTED);
    if (room.matching) return fail(ERR.MATCHING);
    this.dropReplay(room, session.playerId);
    const seat = room.seatOf(session.playerId);
    // a room with gameplay plugins: ready once the page has loaded and checked its content (header "Gameplay plugins")
    if (ready && room.needsContent && seat.content !== 'ready') return fail(ERR.CONTENT_NOT_READY);
    if (seat.ready !== ready) {
      seat.ready = ready;
      this.broadcastState(room);
    }
    return OK;
  }

  async roomCommunication(session, msg) {
    const room = this.roomOf(session);
    if (!room) return fail(ERR.NOT_IN_ROOM);
    if (room.spectatorOf(session.playerId)) return fail(ERR.SPECTATOR);
    if (room.match) return fail(ERR.ROOM_STARTED);
    const chat = msg.t === 'room.chat';
    if (chat ? !validChatText(msg.text) : !EMOTES.includes(msg.id)) return fail(ERR.BAD_MSG);
    if (this.chatReviews.has(session)) return fail(ERR.RATE);
    const last = this.roomMessagesAt.get(session);
    if (last && this.now() - last.at < EMOTE_COOLDOWN_MS) return fail(ERR.RATE);
    const socket = session.ws;
    if (chat && this.nameModeration?.checkChat) {
      const review = Promise.resolve().then(() => this.nameModeration.checkChat(msg.text.trim(), session.limitKey || '?'))
        .catch(() => ({allowed:true}));
      this.chatReviews.set(session, review);
      let verdict;
      try { verdict = await review; } finally { if (this.chatReviews.get(session) === review) this.chatReviews.delete(session); }
      if (this.shuttingDown || !session.connected || session.ws !== socket || this.registry.byId(session.playerId) !== session
        || this.roomOf(session) !== room || room.disposed || room.match || !room.seatOf(session.playerId)) return fail(ERR.WRONG_PHASE);
      if (verdict?.allowed !== true && [ERR.NAME_REJECTED,ERR.BAD_MSG].includes(verdict?.code)) {
        if (verdict.code === ERR.NAME_REJECTED) this.log.info?.('[chat] moderation rejected room message');
        return fail(verdict.code === ERR.BAD_MSG ? ERR.BAD_MSG : ERR.CHAT_REJECTED);
      }
    }
    this.roomMessagesAt.set(session, {at:this.now()});
    this.broadcastRoom(room, chat ? {t:'m.chat',playerId:session.playerId,name:session.name,text:msg.text.trim(),at:this.now()}
      : {t:'m.emote',playerId:session.playerId,id:msg.id});
    return OK;
  }

  setOptions(session, { difficulty, prepMultiplier, battleSpeed }) {
    const room = this.roomOf(session);
    if (!room) return fail(ERR.NOT_IN_ROOM);
    if (room.hostId !== session.playerId) return fail(ERR.NOT_HOST);
    if (room.match) return fail(ERR.ROOM_STARTED);
    if (room.matching) return fail(ERR.MATCHING);
    if (!DIFFICULTIES.includes(difficulty) || !isPrepMultiplier(prepMultiplier)
      || ![1, 2, 3, 4].includes(battleSpeed)) return fail(ERR.BAD_MSG);
    const prep = room.mode === 'coop' ? normalizePrepMultiplier(prepMultiplier) : null;
    if (room.difficulty !== difficulty || room.prepMultiplier !== prep
      || room.prepSeconds != null || room.battleSpeed !== battleSpeed) {
      this.dropReplay(room, session.playerId);
      // Changing pacing preserves a plugin mode; choosing another official difficulty leaves it.
      if (room.difficulty !== difficulty && room.content?.modeId) {
        const {modeId:_modeId,...content}=room.content;room.content=Object.freeze(content);
      }
      Object.assign(room, {difficulty, prepMultiplier: prep, prepSeconds: null, battleSpeed});
      for (const seat of room.seats) if (seat && !seat.isBot && seat.playerId !== room.hostId) seat.ready = false;
      this.broadcastState(room);
    }
    return OK;
  }

  setDifficulty(session, { difficulty }) {
    const room = this.roomOf(session);
    if (!room) return fail(ERR.NOT_IN_ROOM);
    if (room.hostId !== session.playerId) return fail(ERR.NOT_HOST);
    if (room.match) return fail(ERR.ROOM_STARTED);
    if (room.matching) return fail(ERR.MATCHING);
    // the room's version offers it (header "Official versions": 第二期上半 / 第一期 have no 终极)
    if (!this.offered(room.version, room.mode).includes(difficulty)) return fail(ERR.BAD_TARGET, 'not a mode of this version');
    this.dropReplay(room, session.playerId);
    // a plugin mode chosen (header "Gameplay plugins") carries its own difficulty: picking one leaves it
    if (room.difficulty !== difficulty || room.content?.modeId) {
      room.difficulty = difficulty;
      if (room.content?.modeId) { const rest = { ...room.content }; delete rest.modeId; room.content = Object.freeze(rest); }
      for (const s of room.seats) if (s && !s.isBot && s.playerId !== room.hostId) s.ready = false;
      this.broadcastState(room);
    }
    return OK;
  }

  /** Enable the developer console for this private room. The browser owns the five-second warning countdown; the
   * server remains authoritative about who may enable it and prevents any matchmaking-room use. */
  enableConsole(session) {
    const room = this.roomOf(session);
    if (!room) return fail(ERR.NOT_IN_ROOM);
    if (room.match) return fail(ERR.ROOM_STARTED);
    if (room.matching) return fail(ERR.MATCHING, 'console and matchmaking are mutually exclusive');
    if (room.spectatorOf(session.playerId)) return fail(ERR.SPECTATOR);
    const personal = room.mode === 'solo' && !!room.seatOf(session.playerId);
    if (!personal && room.hostId !== session.playerId) return fail(ERR.NOT_HOST);
    if (room.consoleEnabled) return fail(ERR.ALREADY);
    room.consoleEnabled = true;
    this.broadcastState(room);
    this.log.info(`[lobby] ${room.code} console enabled by ${session.name}`);
    return OK;
  }

  /** Host-only opt-out while the room is still in its lobby. Running matches keep their immutable authorization. */
  disableConsole(session) {
    const room = this.roomOf(session);
    if (!room) return fail(ERR.NOT_IN_ROOM);
    if (room.match) return fail(ERR.ROOM_STARTED);
    if (room.spectatorOf(session.playerId)) return fail(ERR.SPECTATOR);
    const personal = room.mode === 'solo' && !!room.seatOf(session.playerId);
    if (!personal && room.hostId !== session.playerId) return fail(ERR.NOT_HOST);
    if (!room.consoleEnabled) return fail(ERR.ALREADY);
    room.consoleEnabled = false;
    this.broadcastState(room);
    this.log.info(`[lobby] ${room.code} console disabled by ${session.name}`);
    return OK;
  }

  /** 「AI 队友最后选择」 (GitHub #338): host-only, before the match, co-op rooms only (a solo room has no AI seat). */
  /** Host-only opt-in, fixed before play; inherited seat metrics never become personal rewards (§35.100). */
  setAiTakeover(session, { on }) {
    const room = this.roomOf(session);
    if (!room) return fail(ERR.NOT_IN_ROOM);
    if (room.hostId !== session.playerId) return fail(ERR.NOT_HOST);
    if (room.match) return fail(ERR.ROOM_STARTED);
    if (room.mode === 'solo' || (on && (room.modded || room.version !== DEFAULT_VERSION))) return fail(ERR.BAD_TARGET);
    if (room.aiTakeoverEnabled !== on) {
      this.dropReplay(room, session.playerId);
      room.aiTakeoverEnabled = on;
      resetAiTakeover(room);
      for (const seat of room.seats) if (seat && !seat.isBot && seat.playerId !== room.hostId) seat.ready = false;
      this.broadcastState(room);
    }
    return OK;
  }

  setAiPicksLast(session, { on }) {
    const room = this.roomOf(session);
    if (!room) return fail(ERR.NOT_IN_ROOM);
    if (room.hostId !== session.playerId) return fail(ERR.NOT_HOST);
    if (room.match) return fail(ERR.ROOM_STARTED);
    if (room.mode === 'solo') return fail(ERR.BAD_TARGET, 'solo rooms have no AI teammates');
    this.dropReplay(room, session.playerId);
    if (room.aiPicksLast !== on) {
      room.aiPicksLast = on;
      for (const s of room.seats) if (s && !s.isBot && s.playerId !== room.hostId) s.ready = false;
      this.broadcastState(room);
    }
    return OK;
  }

  /**
   * 「不限时」 (DESIGN §35.23.10): host-only, before the match, a solo room of a version whose solo is timed. `on: false`
   * clears the flag and drops the room.state key. A co-op room or a version whose solo is already untimed is BAD_TARGET.
   */
  setSoloUnlimited(session, { on }) {
    const room = this.roomOf(session);
    if (!room) return fail(ERR.NOT_IN_ROOM);
    if (room.spectatorOf(session.playerId)) return fail(ERR.SPECTATOR);
    if (room.hostId !== session.playerId) return fail(ERR.NOT_HOST);
    if (room.match) return fail(ERR.ROOM_STARTED);
    if (room.mode !== 'solo' || !this.versionSoloTimed(room.version)) return fail(ERR.BAD_TARGET, 'this version\'s solo is not timed');
    this.dropReplay(room, session.playerId);
    const next = on === true;
    if (room.soloUnlimited !== next) {
      room.soloUnlimited = next;
      this.broadcastState(room);
    }
    return OK;
  }

  /**
   * room.setPlugins (header "The room's plugins", "Gameplay plugins"): host-only, before the match; the set of the plugins
   * asked for becomes the room's content and the other humans are un-readied — nothing changes (and nobody is un-readied)
   * when it is the set the room already has. The host's result replay (a settlement screen still open) is dropped only
   * when the set did change: re-applying the same plugins, or a refused set, leaves it.
   */
  setPlugins(session, { plugins }) {
    const room = this.roomOf(session);
    if (!room) return fail(ERR.NOT_IN_ROOM);
    if (room.hostId !== session.playerId) return fail(ERR.NOT_HOST);
    if (room.match) return fail(ERR.ROOM_STARTED);
    if (room.versionVote) return fail(ERR.VERSION_VOTE);
    const ids = [...new Set(plugins.map((p) => p.id))];
    /** @type {Record<string, Record<string, unknown>>} */
    const settings = {};
    for (const p of plugins) if (p.settings) settings[p.id] = p.settings;
    const r = this.resolveContent(room, ids, settings);
    if ('error' in r) return r;
    let content = r.content;
    const before = room.content;
    const sameSet = (before?.vs ?? null) === (content?.vs ?? null) && (before?.cs ?? null) === (content?.cs ?? null);
    const marks = (c) => JSON.stringify((c?.plugins || []).map((p) => [p.id, !!p.auto, p.settings || null]));
    if (sameSet && marks(before) === marks(content)) return OK;
    this.dropReplay(room, session.playerId);
    // another set: a notice still waiting for the end of a match (pluginsChanged) is moot
    if (!sameSet) { room.pluginsChanged = null; room.pluginNoticeKeys = {}; }
    // the plugin mode chosen stays while the set still provides it (header "Gameplay plugins")
    if (before?.modeId && content?.modes?.some((m) => m.id === before.modeId)) content = Object.freeze({ ...content, modeId: before.modeId });
    room.content = content;
    room.recoveryContentMissing = false;
    if (!sameSet) {
      this.holdContent(content);
      this.releaseContent(before);
      for (const s of room.seats) if (s && !s.isBot && s.playerId !== room.hostId) s.ready = false;
      // another content set: every page loads and checks it again (room.contentReady)
      if ((before?.cs ?? null) !== (content?.cs ?? null)) for (const s of [...room.seats, ...room.spectators]) if (s && !s.isBot)  { s.content = null; s.consentCs = null; }
      this.log.info(`[lobby] ${room.code} plugins: ${content?.plugins?.length ? content.plugins.map((p) => `${p.id}@${p.version}`).join(', ') : 'none'}${room.modded ? ` (content ${content.cs.slice(0, 8)})` : ''}`);
    }
    this.broadcastState(room);
    return OK;
  }

  /**
   * The content a room gets for the plugins `ids` (header "The room's plugins", "Gameplay plugins"): the vanilla set for
   * none, else what the room sets resolve — cosmetic plugins only: the vanilla cs with their `vs`; content plugins: the
   * content set's own cs (`vanilla: false`). Nothing is held yet (holdContent). On another official version (header
   * "Official versions") the base is that version's content (its cs, `version`) and gameplay plugins are refused
   * (VERSION_UNSUPPORTED).
   * @param {Room | null} room @param {string[]} ids @param {Record<string, Record<string, unknown>>} [settings]
   * @param {string} [version] the version the content is for (default: the room's)
   * @param {Room['content'] | null} [replacing] the content this change frees (default: the room's — room.create passes
   *   the creator's old room's when it goes away with the create: its set counts as freed against limits.maxSets)
   * @returns {{ content: Room['content'] } | { error: string, detail?: string }}
   */
  resolveContent(room, ids, settings = {}, version = room ? room.version : DEFAULT_VERSION, replacing = room?.content ?? null) {
    const base = this.baseContent(version);
    if (!ids.length) {
      // the server owner may fix every room's plugins (plugins/config.json rooms: fixed): the original game is not one
      const fixed = (() => { try { return this.plugins?.fixed?.() || null; } catch { return null; } })();
      if (fixed && fixed.length) return fail(ERR.PLUGIN_BLOCKED, 'this server fixes every room\'s plugins (plugins/config.json rooms: fixed)');
      return { content: base };
    }
    if (!this.vanilla || !this.plugins || !base) return fail(ERR.PLUGIN_UNKNOWN, 'this server applies no plugins');
    const gameplay = version === DEFAULT_VERSION;
    let r;
    try { r = this.plugins.resolve(ids, { scope: 'room', settings, replacing, gameplay }); } catch (e) {
      this.log.error(`[lobby] ${room?.code ?? '----'} plugin set failed`, e);
      return fail(ERR.INTERNAL);
    }
    if (!r || !r.ok) return fail(r && isErrCode(r.error) ? r.error : ERR.INTERNAL, r && typeof r.detail === 'string' ? r.detail.slice(0, 200) : undefined);
    const { cs, vs, plugins: list, warnings, bytes, dataBytes, modes, kitted, trusted, execution, rules } = r.set;
    const modded = isContentHash(cs) && cs !== this.vanilla.cs;
    // (roomSets refuses them itself; a room-sets object that does not know the option must not slip one through)
    if (modded && !gameplay) return fail(ERR.VERSION_UNSUPPORTED, 'gameplay plugins play the default version (act2autochess) only');
    const frozen = (a) => Object.freeze((Array.isArray(a) ? a : []).map((p) => Object.freeze({ ...p })));
    // the operators its plugins add to a 自选 slot's list (welcome.diyKitted holds the server's own): the pages' pickers
    const extra = modded && Array.isArray(kitted) ? kitted.filter((id) => typeof id === 'string' && !VANILLA_KITTED.has(id)).slice(0, 200) : [];
    return {
      content: Object.freeze({
        cs: modded ? cs : base.cs,
        vanilla: !modded,
        ...(base.version ? { version: base.version } : {}),
        ...(vs ? { vs } : {}),
        plugins: frozen(list),
        ...(trusted ? {trusted} : {}),
        ...(execution ? {execution} : {}),
        warnings: Object.freeze([...(warnings || [])]),
        bytes: Number(bytes) || 0,
        ...(modded ? { dataBytes: Number(dataBytes) || 0, modes: frozen(modes), ...(extra.length ? { kittedExtra: Object.freeze(extra) } : {}) } : {}),
        ...(rules ? { rules } : {}),
      }),
    };
  }

  /** A room now uses `content`: its visual set and its content set are held (released by releaseContent). */
  holdContent(content) {
    if (content?.vs) this.plugins?.hold?.(content.vs);
    if (content && content.vanilla === false) this.plugins?.holdContent?.(content.cs);
  }

  /** A room no longer uses `content`. */
  releaseContent(content) {
    if (content?.vs) this.plugins?.release?.(content.vs);
    if (content && content.vanilla === false) this.plugins?.releaseContent?.(content.cs);
  }

  /**
   * room.setMode (header "Gameplay plugins"): host-only, before the match. An official mode of the room's type sets its
   * difficulty (and leaves a plugin mode); a mode of the room's content set (content.modes, the room's type) becomes
   * content.modeId — its difficulty the room's. Like a difficulty change it un-readies the other humans.
   */
  setMode(session, { modeId }) {
    const room = this.roomOf(session);
    if (!room) return fail(ERR.NOT_IN_ROOM);
    if (room.hostId !== session.playerId) return fail(ERR.NOT_HOST);
    if (room.match) return fail(ERR.ROOM_STARTED);
    if (room.versionVote) return fail(ERR.VERSION_VOTE);
    const official = DIFFICULTIES.find((d) => modeIdFor(room.mode, d) === modeId);
    let difficulty = room.difficulty;
    let content = room.content;
    if (official) {
      // the room's version offers it (header "Official versions")
      if (!this.offered(room.version, room.mode).includes(official)) return fail(ERR.BAD_TARGET, 'not a mode of this version');
      difficulty = official;
      if (content?.modeId) { const rest = { ...content }; delete rest.modeId; content = Object.freeze(rest); }
    } else {
      const mode = Array.isArray(content?.modes) ? content.modes.find((m) => m && m.id === modeId) : null;
      if (!mode) return fail(ERR.BAD_TARGET, 'not a mode of this room');
      if (mode.roomMode !== room.mode) return fail(ERR.BAD_TARGET, `a mode of ${mode.roomMode} rooms`);
      if (DIFFICULTIES.includes(mode.difficulty)) difficulty = mode.difficulty;
      if (content.modeId !== modeId) content = Object.freeze({ ...content, modeId });
    }
    if (difficulty === room.difficulty && content === room.content) return OK;
    this.dropReplay(room, session.playerId);
    room.difficulty = difficulty;
    room.content = content;
    room.recoveryContentMissing = false;
    for (const s of room.seats) if (s && !s.isBot && s.playerId !== room.hostId) s.ready = false;
    this.broadcastState(room);
    return OK;
  }

  /**
   * room.contentReady { cs, ok? } (header "Gameplay plugins"): the member's page has loaded and checked the room's content
   * set (`ok: false`: it could not). Recorded for the room's current set only — a page that checked an older one is
   * answered OK and changes nothing — and only for the page that is there: a session whose socket is gone, or a message
   * that waited on the room's queue across a disconnect of its seat (`ctx.from`: the seat's generation when it was
   * queued), is answered OK and writes nothing (the page that comes back checks the set again).
   * @param {import('./net.js').Session} session @param {{ cs: string, ok?: boolean }} msg
   * @param {{ from?: { seat: Seat, gen: number } | null } | null} [ctx]
   */
  contentReady(session, { cs, ok }, ctx = null) {
    const room = this.roomOf(session);
    if (!room) return fail(ERR.NOT_IN_ROOM);
    if (!room.needsContent || room.content?.cs !== cs) return OK;
    if (!session.connected) return OK;
    const seat = room.seatOf(session.playerId) || room.spectatorOf(session.playerId);
    if (!seat) return OK;
    if (ctx && ctx.from && (ctx.from.seat !== seat || ctx.from.gen !== (seat.contentGen || 0))) return OK;
    if (ok !== false && room.content?.trusted && room.seatOf(session.playerId) && seat.consentCs !== cs) return fail(ERR.PLUGIN_CONSENT);
    const state = ok === false ? 'failed' : 'ready';
    if (seat.content === state) return OK;
    seat.content = state;
    if (state === 'failed') this.log.warn(`[lobby] ${room.code} ${session.name}: the room's content ${cs.slice(0, 8)} did not load or check on that page`);
    this.broadcastState(room);
    return OK;
  }

  /** Each live session consents only for its own seat and the current cs. Reconnect keeps the seat. */
  consent(session, {cs,accept}) {
    const room = this.roomOf(session);
    if (!room) return fail(ERR.NOT_IN_ROOM);
    const seat = room.seatOf(session.playerId);
    if (!seat || seat.isBot) return fail(ERR.SPECTATOR);
    if (!session.connected || !room.content?.trusted || room.content.cs !== cs) return fail(ERR.PLUGIN_CONSENT);
    if (room.match) return fail(ERR.ROOM_STARTED);
    const changed = (seat.consentCs === cs) !== accept;
    seat.consentCs = accept ? cs : null;
    if (changed) seat.content = null;
    if (!accept) { seat.ready = false; seat.content = null; }
    this.broadcastState(room);
    return OK;
  }

  // ---------------------------------------------------------------------------------------------------
  // Official versions (header "Official versions")
  // ---------------------------------------------------------------------------------------------------

  /**
   * The server's default version (a room created without one, the settings outside a room). When the configured one's
   * data failed to load: 第二期下半 if enabled, else the first enabled version that loads (server/versions.js welcome
   * marks the same one the default).
   */
  defaultVersion() {
    const v = this.versions;
    const id = v?.defaultId ?? DEFAULT_VERSION;
    if (!v || this.versionAvailable(id)) return id;
    if (v.isEnabled(DEFAULT_VERSION)) return DEFAULT_VERSION;
    return v.ids.find((x) => this.versionAvailable(x)) ?? id;
  }

  /** Does this server offer the version `id`? @param {unknown} id */
  versionEnabled(id) { return this.versions ? this.versions.isEnabled(id) : id === DEFAULT_VERSION; }

  /**
   * Can a room play the enabled version `id` now? Another version's data loads on first use (a room of it loads it
   * anyway); a failed load is remembered (server/versions.js available), and such a version is never offered again.
   * @param {string} id
   */
  versionAvailable(id) { return id === DEFAULT_VERSION || typeof this.versions?.available !== 'function' || this.versions.available(id); }

  /** A room's content base for a version: the vanilla content for 第二期下半, else the version's own. @param {string} v */
  baseContent(v) {
    if (v === DEFAULT_VERSION || !this.versions) return this.vanilla;
    return this.versions.content(v) || null;
  }

  /**
   * The difficulties a version offers a room mode (DIFFICULTIES for 第二期下半 / a server without versions).
   * @param {string} v @param {string} mode @returns {readonly string[]}
   */
  offered(v, mode) {
    if (!this.versions || v === DEFAULT_VERSION) return DIFFICULTIES;
    return this.versions.offered(v, /** @type {'solo' | 'coop'} */ (mode));
  }

  /**
   * Does this version's solo use the official per-round timers (`config.version.rules.soloTimed`)? 第二期下半, a server
   * without the versions service, and a version whose data cannot be read: no.
   * @param {string} id
   */
  versionSoloTimed(id) {
    if (!id || id === DEFAULT_VERSION || !this.versions) return false;
    try {
      const data = this.versions.data(id);
      return data?.config?.version?.rules?.soloTimed === true;
    } catch (e) {
      this.log.error(`[lobby] the solo timer of ${id} failed`, e);
      return false;
    }
  }

  /**
   * `d`, or the difficulty the version offers instead: the highest below it, else its lowest (终极 → 绝境).
   * @param {string} v @param {string} mode @param {string} d
   */
  fallbackDifficulty(v, mode, d) {
    const offered = this.offered(v, mode);
    if (!offered.length || offered.includes(d)) return d;
    const below = DIFFICULTIES.slice(0, Math.max(0, DIFFICULTIES.indexOf(d))).reverse().find((x) => offered.includes(x));
    return below || offered[0];
  }

  /**
   * room.proposeVersion { version } (host, before the match): a lone active human switches at once, else the seated
   * humans vote (header "Official versions").
   */
  proposeVersion(session, { version }) {
    const room = this.roomOf(session);
    if (!room) return fail(ERR.NOT_IN_ROOM);
    if (room.spectatorOf(session.playerId)) return fail(ERR.SPECTATOR);
    if (room.hostId !== session.playerId) return fail(ERR.NOT_HOST);
    if (room.match) return fail(ERR.ROOM_STARTED);
    if (!this.versionEnabled(version)) return fail(ERR.VERSION_UNKNOWN);
    if (!this.offered(version, room.mode).length) return fail(ERR.VERSION_UNSUPPORTED, `${version} has no ${room.mode} rooms`);
    if (room.modded && version !== DEFAULT_VERSION) return fail(ERR.VERSION_UNSUPPORTED, 'gameplay plugins play the default version (act2autochess) only');
    if (version === room.version) return fail(ERR.ALREADY);
    if (room.versionVote) return fail(ERR.VERSION_VOTE);
    const now = this.now();
    if (now - room.versionProposeAt < this.opts.versionProposeGapMs || now < room.versionRetryAt) return fail(ERR.RATE);
    const humans = room.activeHumans();
    if (humans.some((s) => !s.connected)) return fail(ERR.NOT_READY);
    if (!this.versionAvailable(version)) return fail(ERR.VERSION_UNSUPPORTED, 'the data of this version is not available');
    room.versionProposeAt = now;
    // the room's cosmetic plugins must resolve on the target (the server owner's policy, a plugin refused there)
    const ids = (room.content?.plugins || []).filter((p) => !p.auto).map((p) => p.id);
    if (ids.length) {
      const r = this.resolveContent(room, ids, this.pluginSettings(room.content), version);
      if ('error' in r) return fail(ERR.VERSION_UNSUPPORTED, `the room's plugins do not apply to ${version}: ${r.error}`);
    }
    this.dropReplay(room, session.playerId);
    if (humans.length === 1) { this.applyVersion(room, version, 'alone'); return OK; }
    room.versionVoteSeq = room.versionVoteSeq >= 2 ** 31 ? 1 : room.versionVoteSeq + 1;
    const id = room.versionVoteSeq;
    const ms = Math.max(0, Number(this.opts.versionVoteMs) || 0);
    const timer = setTimeout(() => {
      const run = () => { if (!room.disposed && room.versionVote?.id === id) this.voidVersionVote(room, 'expired'); };
      // in order with the room's messages when something of the room is still pending (header "Gameplay plugins")
      if (room.queue.pending > 0) this.queueEvent(room, run); else run();
    }, ms);
    timer.unref?.();
    room.versionVote = { id, proposerId: session.playerId, version, voters: humans.map((s) => s.playerId), agreed: new Set([session.playerId]), expiresAt: now + ms, timer };
    this.log.info(`[lobby] ${room.code} version vote #${id} → ${version} (${humans.length} voters)`);
    this.broadcastState(room);
    return OK;
  }

  /** room.versionVote { voteId, agree } (a voter): a decline cancels the vote, the last agreement switches. */
  versionVote(session, { voteId, agree }) {
    const room = this.roomOf(session);
    if (!room) return fail(ERR.NOT_IN_ROOM);
    if (room.spectatorOf(session.playerId)) return fail(ERR.SPECTATOR);
    const vote = room.versionVote;
    if (!vote) return fail(ERR.WRONG_PHASE);
    if (vote.id !== voteId) return fail(ERR.BAD_TARGET, 'vote changed');
    if (!vote.voters.includes(session.playerId)) return fail(ERR.BAD_TARGET, 'not a voter');
    this.dropReplay(room, session.playerId);
    if (!agree) {
      this.voidVersionVote(room, 'declined', session.name);
      return OK;
    }
    if (vote.agreed.has(session.playerId)) return OK;
    vote.agreed.add(session.playerId);
    if (vote.voters.every((id) => vote.agreed.has(id))) this.applyVersion(room, vote.version, 'vote');
    else this.broadcastState(room);
    return OK;
  }

  /** room.cancelVersionVote { voteId } (host): the vote ends, the room keeps its version. */
  cancelVersionVote(session, { voteId }) {
    const room = this.roomOf(session);
    if (!room) return fail(ERR.NOT_IN_ROOM);
    if (room.spectatorOf(session.playerId)) return fail(ERR.SPECTATOR);
    if (room.hostId !== session.playerId) return fail(ERR.NOT_HOST);
    if (!room.versionVote) return fail(ERR.WRONG_PHASE);
    if (room.versionVote.id !== voteId) return fail(ERR.BAD_TARGET, 'vote changed');
    this.dropReplay(room, session.playerId);
    this.voidVersionVote(room, 'cancelled');
    return OK;
  }

  /**
   * End the room's open version vote without a switch and tell its members (header "Official versions"): `declined`
   * (by `name`; every member), `expired` (every member), `members` (a seat or the host changed, a voter dropped, a match
   * started; every member), `cancelled` (by the host; everyone but the host). A declined or expired vote holds the next
   * proposal back versionRetryMs. room.state is broadcast — but for `members`: every such caller broadcasts it next.
   * @param {Room} room @param {'declined' | 'expired' | 'members' | 'cancelled'} reason @param {string} [name]
   */
  voidVersionVote(room, reason, name = '') {
    const vote = room.versionVote;
    if (!vote) return;
    clearTimeout(vote.timer);
    room.versionVote = null;
    if (reason === 'declined' || reason === 'expired') room.versionRetryAt = this.now() + this.opts.versionRetryMs;
    this.log.info(`[lobby] ${room.code} version vote #${vote.id} ended (${reason})`);
    if (room.disposed) return;
    if (reason !== 'members') this.broadcastState(room);
    const text = reason === 'declined' ? msg('{name}拒绝了切换版本', { name })
      : reason === 'expired' ? msg('切换版本投票已超时，房间版本未改变')
        : reason === 'cancelled' ? msg('创建者取消了切换版本投票')
          : msg('同盟成员有变动，切换版本投票已取消');
    const toast = { t: 'm.toast', kind: reason === 'cancelled' ? 'info' : 'warn', ...wireMessage(text) };
    if (reason !== 'cancelled') { this.broadcastRoom(room, toast); return; }
    for (const s of [...room.seats, ...room.spectators]) if (s && !/** @type {any} */ (s).isBot && s.playerId !== room.hostId) this.sendToPlayer(room, s.playerId, toast);
  }

  /** The per-plugin settings of a room content's plugins (to resolve the same choice again). */
  pluginSettings(content) {
    /** @type {Record<string, Record<string, unknown>>} */
    const out = {};
    for (const p of content?.plugins || []) if (p.settings && typeof p.settings === 'object') out[p.id] = { ...p.settings };
    return out;
  }

  /**
   * Switch the room to `version` (header "Official versions"): its difficulty, its content (the version's base with the
   * room's cosmetic plugins again — none when they no longer resolve), every member's page loading it, the other humans
   * un-readied, the whole result replay and every human seat's stored settings dropped, a seat card the version lacks
   * dropped. Broadcast.
   * @param {Room} room @param {string} version @param {'vote' | 'alone'} how
   */
  applyVersion(room, version, how) {
    if (room.versionVote) { clearTimeout(room.versionVote.timer); room.versionVote = null; }
    const before = room.content;
    room.version = version;
    // 「不限时」 belongs to a timed solo only (header): a co-op room, or a version whose solo is not timed, drops it.
    // Switching between the two 第一期 versions keeps it.
    if (room.mode !== 'solo' || !this.versionSoloTimed(version)) room.soloUnlimited = false;
    room.difficulty = this.fallbackDifficulty(version, room.mode, room.difficulty);
    let next = this.baseContent(version);
    const ids = (before?.plugins || []).filter((p) => !p.auto).map((p) => p.id);
    if (ids.length) {
      const r = this.resolveContent(room, ids, this.pluginSettings(before));
      if ('content' in r && r.content && r.content.vanilla !== false) next = r.content;
      else this.warnOnce(`[lobby] ${room.code} plugins (${ids.join(', ')}) dropped on the switch to ${version}: ${'error' in r ? r.error : '?'}${'detail' in r && r.detail ? ` (${r.detail})` : ''}`);
    }
    room.content = next;
    this.holdContent(next);
    this.releaseContent(before);
    room.pluginsChanged = null;
    room.pluginNoticeKeys = {};
    room.replay = null;
    const data = this.dataFor(room);
    const operators = chessCharIds(data);
    for (const s of [...room.seats, ...room.spectators]) {
      if (!s || /** @type {any} */ (s).isBot) continue;
      const seat = /** @type {Seat} */ (s);
      seat.content = null;
      seat.consentCs = null;
    }
    for (const s of room.seats) {
      if (!s || s.isBot) continue;
      if (s.playerId !== room.hostId) s.ready = false;
      s.loadout = null; s.ops = null; s.notOwned = null; s.diy = null;
      s.loadoutCs = null; s.notOwnedCs = null; s.diyCs = null;
      if (s.card && !operators.has(cardPortraitOperatorId(s.card.charId))) s.card = null;
    }
    this.log.info(`[lobby] ${room.code} version → ${version} (${how})`);
    this.broadcastState(room);
  }

  addBot(session) {
    const room = this.roomOf(session);
    if (!room) return fail(ERR.NOT_IN_ROOM);
    if (room.hostId !== session.playerId) return fail(ERR.NOT_HOST);
    if (room.match) return fail(ERR.ROOM_STARTED);
    if (room.matching) return fail(ERR.MATCHING);
    this.dropReplay(room, session.playerId);
    if (room.mode === 'solo') return fail(ERR.ROOM_FULL, 'solo rooms cannot have AI teammates');
    const idx = room.freeSeat();
    if (idx < 0) return fail(ERR.ROOM_FULL);
    const used = new Set(room.seats.filter((s) => s && s.isBot).map((s) => s.name));
    const name = BOT_NAMES.find((n) => !used.has(n)) || `AI·${idx + 1}`;
    let playerId;
    do playerId = 'ai_' + randomBytes(4).toString('hex'); while (room.seatOf(playerId));
    room.seats[idx] = { seat: idx, playerId, name, isBot: true, ready: true, connected: true, left: false };
    this.broadcastState(room);
    return OK;
  }

  removeBot(session, { seat }) {
    const room = this.roomOf(session);
    if (!room) return fail(ERR.NOT_IN_ROOM);
    if (room.hostId !== session.playerId) return fail(ERR.NOT_HOST);
    if (room.match) return fail(ERR.ROOM_STARTED);
    if (room.matching) return fail(ERR.MATCHING);
    this.dropReplay(room, session.playerId);
    const target = room.seats[seat];
    if (!target || !target.isBot) return fail(ERR.BAD_TARGET, 'seat does not hold an AI');
    room.seats[seat] = null;
    this.broadcastState(room);
    return OK;
  }

  /** Host removes another human before the match (header: room.kick). */
  kick(session, { seat, playerId }) {
    const room = this.roomOf(session);
    if (!room) return fail(ERR.NOT_IN_ROOM);
    if (room.hostId !== session.playerId) return fail(ERR.NOT_HOST);
    if (room.match) return fail(ERR.ROOM_STARTED);
    this.dropReplay(room, session.playerId);
    const target = room.seats[seat];
    if (!target || target.left) return fail(ERR.BAD_TARGET, 'seat holds no player');
    if (target.playerId !== playerId) return fail(ERR.BAD_TARGET, 'seat changed hands'); // the confirmed player left meanwhile
    if (target.isBot) return fail(ERR.BAD_TARGET, 'seat holds an AI (room.removeBot)');
    if (target.playerId === session.playerId) return fail(ERR.BAD_TARGET, 'cannot kick yourself');
    const kicked = this.registry.byId(target.playerId);
    const wasHere = !!kicked && kicked.roomCode === room.code;
    const replay = this.replayFor(room, target.playerId);
    this.removeMember(room, target.playerId);
    if (wasHere) {
      if (kicked.connected) sendSession(kicked, { t: 'room.closed', reason: 'kicked' });
      else { kicked.notice = 'kicked'; kicked.pendingResult = replay; }
    }
    this.log.info(`[lobby] ${room.code} ${target.name} removed by the host`);
    return OK;
  }

  start(session) {
    const room = this.roomOf(session);
    if (!room) return fail(ERR.NOT_IN_ROOM);
    if (room.hostId !== session.playerId) return fail(ERR.NOT_HOST);
    if (room.match) return fail(ERR.ROOM_STARTED);
    if (room.matching) return fail(ERR.MATCHING);
    if (room.versionVote) return fail(ERR.VERSION_VOTE);
    const humans = room.activeHumans();
    if (this.accountSeatConflict(humans)) return fail(ERR.ACCOUNT_ACTIVE);
    if (room.content?.trusted && humans.some(s => s.consentCs !== room.content.cs)) return fail(ERR.PLUGIN_CONSENT);
    for (const s of humans) {
      if (s.playerId !== room.hostId && (!s.connected || !s.ready)) return fail(ERR.NOT_READY);
    }
    // a room with gameplay plugins, or of another official version, starts once every player's page has loaded and checked
    // its content (the host's too)
    if (room.needsContent && humans.some((s) => s.content !== 'ready')) return fail(ERR.CONTENT_NOT_READY);
    const bots = room.seats.filter((s) => s && s.isBot);
    if (humans.length < 1 || (room.mode === 'solo' && (humans.length !== 1 || bots.length > 0))) {
      return fail(ERR.BAD_MSG, 'invalid seat configuration');
    }
    const key = session.limitKey || null;
    if (key && this.opts.maxMatchesPerAddr > 0 && this.countRooms((r) => !!r.match && r.matchKey === key) >= this.opts.maxMatchesPerAddr) {
      this.limitWarn(`match limit (${this.opts.maxMatchesPerAddr}) reached for ${session.addr}`);
      return fail(ERR.RATE, 'too many running matches from your network');
    }
    return this.startMatch(room, key);
  }

  /**
   * Any seated player may open or cancel the vote (issue #854); the match owns the vote, the per-seat cooldown and the
   * setup replacement itself. A spectator has no seat and therefore nothing to reroll.
   */
  rerollSetup(session, msg, cancel = false) {
    const room = this.roomOf(session);
    if (!room) return fail(ERR.NOT_IN_ROOM);
    if (room.spectatorOf(session.playerId)) return fail(ERR.SPECTATOR);
    const method = cancel ? 'cancelSetupReroll' : 'requestSetupReroll';
    if (!room.match || typeof room.match[method] !== 'function') return fail(ERR.WRONG_PHASE);
    return this.callMatch(room, method, session.playerId, cancel ? msg.voteId : msg.setupRevision) || fail(ERR.INTERNAL);
  }

  /** Keep cosmetics current in seats, pending queues and external teammates' active matches. */
  skins(session, { skins }) {
    const room = this.roomOf(session);
    const source = this.dataFor(room);
    const checked = checkSkinSelection(skins, (id) => !!source.chess?.[id] || operatorCharIds(source).has(id));
    if (!checked.ok) return fail(ERR.BAD_MSG, 'bad skin selection');
    const clean = freezeSkins(checked.skins, id => source.chess?.[id], id => operatorCharIds(source).has(id));
    session.skins = clean;
    const seat = room?.seatOf(session.playerId);
    if (seat) { const changed = !sameSkins(seat.skins, clean); seat.skins = clean; if (changed && !room.match) this.broadcastState(room); }
    const queued = this.queueByPlayer.get(session.playerId);
    const queuedSeat = queued?.players.find((p) => p.playerId === session.playerId);
    if (queuedSeat) queuedSeat.skins = clean;
    const active = this.activeMatchOf(session);
    const match = active?.queue ? active.match : seat ? room.match : null;
    if (!match) return OK;
    if (typeof match.setSkins !== 'function') return fail(ERR.ROOM_STARTED, 'stored for the next match');
    try {
      return match.setSkins(session.playerId, clean) || OK;
    } catch (e) {
      this.log.error('[lobby] match.setSkins failed', e);
      return fail(ERR.INTERNAL);
    }
  }

  /** Authenticated player's public room display, independent of Match/Worker gameplay state. */
  card(session, msg) {
    if (!isCardPortraitId(msg?.charId) || !isCardAvatarId(msg?.avatar)) return fail(ERR.BAD_MSG);
    const ids = opsCharIds(this.dataFor(this.roomOf(session)));
    if ((msg.charId && !ids.has(cardPortraitOperatorId(msg.charId))) || (msg.avatar && !ids.has(cardAvatarOperatorId(msg.avatar)))) return fail(ERR.BAD_TARGET);
    const clean = cleanPlayerCard(msg, (id) => ids.has(id));
    const previous = session.card;
    session.card = clean;
    const room = this.roomOf(session);
    const seat = room?.seatOf(session.playerId);
    if (seat) seat.card = clean;
    const queuedSeat = this.queueByPlayer.get(session.playerId)?.players.find((p) => p.playerId === session.playerId);
    if (queuedSeat) queuedSeat.card = clean;
    if (seat && (previous?.charId !== clean.charId || previous?.avatar !== clean.avatar)) this.broadcastState(room);
    return OK;
  }

  /**
   * room.loadout (DESIGN §16): check the operator loadout — and its per-operator 潜能 / 练度 `ops` (0.2.2) — against the
   * game data, store both on the session and the seat, and — while a match runs — hand them to the match (accepted only
   * during INFO_CHECK, see the header). Either part refused: nothing is stored.
   */
  loadout(session, { entries, ops }) {
    const room = this.roomOf(session);
    // checked against the room's own data: a room with gameplay plugins knows its plugins' operators (header "Gameplay plugins")
    const data = this.dataFor(room);
    const res = checkLoadout(entries, (id) => lookup('chess', id, data));
    if (!res || res.error) return fail(res && isErrCode(res.error) ? res.error : ERR.BAD_MSG, res && res.detail);
    const ids = opsCharIds(data);
    const resOps = checkLoadoutOps(ops, (id) => ids.has(id), (id) => charPotentialChanges(data, id));
    if (!resOps || resOps.error) return fail(resOps && isErrCode(resOps.error) ? resOps.error : ERR.BAD_MSG, resOps && resOps.detail);
    const loadout = freezeLoadout(res.loadout);
    const opsSet = freezeOps(resOps.ops);
    const cs = this.settingsCs(room, session.playerId);
    session.loadout = loadout;
    session.ops = opsSet;
    session.loadoutCs = cs;
    if (!room) return OK;
    const seat = room.seatOf(session.playerId);
    if (seat) { seat.loadout = loadout; seat.ops = opsSet; seat.loadoutCs = cs; }
    if (!room.match || !seat) return OK; // a spectator's loadout stays on its session, never reaching the match
    if (typeof room.match.setLoadout !== 'function') return fail(ERR.ROOM_STARTED, 'stored for the next match');
    let r;
    try {
      // Preserve named defaults for prep merging: normalisation drops them, but they mean reset this operator.
      r = ruleOption(room.content?.rules, 'prepLoadout') === 'prep'
        ? room.match.setLoadout(session.playerId, entries, ops)
        : room.match.setLoadout(session.playerId, loadout, opsSet);
    } catch (e) {
      this.log.error(`[lobby] ${room.code} match.setLoadout threw`, e);
      return fail(ERR.INTERNAL);
    }
    // a match in a match host answers later (header "Gameplay plugins")
    if (r && typeof r.then === 'function') return Promise.resolve(r).then(matchAnswer, () => fail(ERR.INTERNAL));
    return matchAnswer(r);
  }

  /**
   * room.ownership (0.2.0 补位): keep the droppable chess of the not-owned list, store it on the session and the seat
   * (see the header). A running match never takes it: it keeps the list its seat had at its start.
   */
  ownership(session, { notOwned }) {
    const room = this.roomOf(session);
    const data = this.dataFor(room);
    const res = checkNotOwned(notOwned, (id) => lookup('chess', id, data));
    if (!res || res.error) return fail(ERR.BAD_MSG, res && res.detail);
    const list = Object.freeze(res.notOwned.slice());
    const cs = this.settingsCs(room, session.playerId);
    session.notOwned = list;
    session.notOwnedCs = cs;
    if (!room) return OK;
    const seat = room.seatOf(session.playerId);
    if (seat) { seat.notOwned = list; seat.notOwnedCs = cs; }
    if (room.match && seat) return fail(ERR.ROOM_STARTED, 'stored for the next match');
    return OK;
  }

  /**
   * room.diy (0.2.0 自选编队): keep the legal picks (checkDiyPicks against the data and KITTED_CHARS — the room's own in a
   * room with gameplay plugins), store them on the session and the seat (see the header). A running match never takes
   * them: it keeps the picks its seat had at its start.
   */
  diy(session, { picks }) {
    const room = this.roomOf(session);
    const res = checkDiyPicks(picks, { data: this.dataFor(room), kitted: this.kittedFor(room) });
    if (!res || !('ok' in res)) return fail(ERR.BAD_MSG, res && res.detail);
    const kept = freezeDiy(res.picks);
    const cs = this.settingsCs(room, session.playerId);
    session.diy = kept;
    session.diyCs = cs;
    if (!room) return OK;
    const seat = room.seatOf(session.playerId);
    if (seat) { seat.diy = kept; seat.diyCs = cs; }
    if (room.match && seat) return fail(ERR.ROOM_STARTED, 'stored for the next match');
    return OK;
  }

  /**
   * room.skins (docs/SKINS.md): store the appearances this player chose for their operators, on the session and the
   * seat, and hand them to a running match. A waiting room is shown a changed map (room.state seats[].skins: its seat
   * cards wear them — header 干员皮肤).
   *
   * Unlike room.loadout there is no phase gate. The loadout is frozen at INFO_CHECK because it changes what a unit
   * *does*; a skin changes only what it looks like, and it is public — a teammate switching model mid-match is
   * harmless, and the next `m.public` broadcast carries it to everyone.
   */
  /**
   * The game data of a room's content (header "Gameplay plugins", "Official versions"): its content set's, else its
   * version's — outside a room, the server's default version's —, else the server's. Another version's data that cannot
   * be read is logged and nothing (every check then refuses), never 第二期下半's.
   * @param {Room | null} room
   */
  dataFor(room) {
    if (room?.modded) {
      try {
        const d = this.plugins?.dataOf?.(room.content.cs);
        if (d) return d;
      } catch (e) { this.log.error(`[lobby] ${room.code} content data failed`, e); }
    }
    const v = room ? room.version : this.defaultVersion();
    if (v !== DEFAULT_VERSION) {
      try {
        const d = this.versions?.data(v);
        if (d) return d;
        this.warnOnce(`[lobby] the data of ${v} is not available`);
      } catch (e) { this.log.error(`[lobby] ${room?.code ?? '----'} the data of ${v} failed`, e); }
      return Object.freeze({});
    }
    return this.safeData();
  }

  /** The operators a 自选 slot may field in a room (its content set's list, else the vanilla one). @param {Room | null} room */
  kittedFor(room) {
    if (room?.modded) {
      try {
        const k = this.plugins?.kittedOf?.(room.content.cs);
        if (Array.isArray(k)) return k;
      } catch (e) { this.log.error(`[lobby] ${room.code} content 自选 list failed`, e); }
    }
    return KITTED_CHARS;
  }

  /**
   * The content a setting stored now is checked for: the room's cs, else (outside a room) the server's default version's
   * — the vanilla one unless the server's default is another version. @param {Room | null} room
   */
  csOf(room) { return room?.content?.cs ?? this.baseContent(this.defaultVersion())?.cs ?? this.vanilla?.cs ?? null; }

  /**
   * The stamp of a setting a player sends now (loadout / ownership / diy): csOf(room) — but in a room whose pages must
   * load its content (needsContent) only once the sender's page reported that content ready; before, UNVERIFIED_CS: the
   * page may still show another version's data, whose chess ids name other operators (header "Official versions").
   * @param {Room | null} room @param {string} playerId
   */
  settingsCs(room, playerId) {
    if (!room || !room.needsContent) return this.csOf(room);
    const seat = room.seatOf(playerId) || room.spectatorOf(playerId);
    return seat && /** @type {any} */ (seat).content === 'ready' ? this.csOf(room) : UNVERIFIED_CS;
  }

  /**
   * The data a setting stamped with `cs` was checked against: the vanilla data, a version's, a content set's — null when
   * none is known (an unverified stamp, a set no longer kept). @param {string | null} cs
   */
  dataOfCs(cs) {
    if (!cs || cs === UNVERIFIED_CS) return null;
    if (this.vanilla && cs === this.vanilla.cs) return this.safeData();
    try {
      const v = this.versions?.dataOfCs?.(cs);
      if (v) return v;
      const p = this.plugins?.dataOf?.(cs);
      if (p) return p;
    } catch (e) { this.log.error(`[lobby] the data of content ${String(cs).slice(0, 8)} failed`, e); }
    return null;
  }

  /**
   * A human seat's stored settings for a match of `room` (header "Gameplay plugins", the design study's §6.9): kept as
   * they are when they were checked for the room's content; filtered to its data otherwise — an id it does not know is
   * dropped, the rest kept (never the whole setting refused). A loadout or 干员持有 list checked for another data set also
   * loses every chess id whose operator (charId) differs between the two (header "Official versions": chess ids are
   * reused across versions); in a room of another version than 第二期下半, one whose data is unknown (an unverified
   * stamp) is dropped whole.
   * @param {Room} room @param {Seat} s @param {Readonly<Record<string, any>>} data
   */
  seatSettings(room, s, data) {
    const cs = this.csOf(room);
    const vanillaCs = this.vanilla?.cs ?? null;
    const other = (checked) => !!cs && (checked ?? vanillaCs) !== cs;
    const versioned = room.version !== DEFAULT_VERSION;
    let loadout = s.loadout || null;
    let ops = s.ops || null;
    let notOwned = s.notOwned || null;
    let diy = s.diy || null;
    const chess = (id) => lookup('chess', id, data);
    /** the chess ids of `from` whose operator is the room data's too (null `from`: every id) */
    const sameOperator = (from, id) => !from || (lookup('chess', id, from)?.charId ?? null) === (chess(id)?.charId ?? undefined);
    if (loadout && other(s.loadoutCs)) {
      const from = this.dataOfCs(s.loadoutCs ?? vanillaCs);
      const keep = {};
      if (from || !versioned) {
        for (const [id, e] of Object.entries(loadout)) {
          if (!sameOperator(from, id)) continue;
          const r = checkLoadout({ [id]: { skill: e.skill, ...(e.module != null ? { module: e.module } : {}) } }, chess);
          if (r && !r.error && r.loadout[id]) keep[id] = r.loadout[id];
        }
      }
      loadout = freezeLoadout(keep);
      const ids = opsCharIds(data);
      const changes = (x) => charPotentialChanges(data, x);
      const keepOps = {};
      for (const [id, e] of Object.entries(ops || {})) {
        // a 潜能 that changes nothing on this content's operator (a plugin's char_x_ without a curve) is dropped, its 练度
        // kept — as the page's sanitizeOps does (public/js/ui/loadoutModel.js)
        const one = changes(id) === false ? { cultivate: e.cultivate } : { potential: e.potential, cultivate: e.cultivate };
        const r = checkLoadoutOps({ [id]: one }, (x) => ids.has(x), changes);
        if (r && !r.error && r.ops[id]) keepOps[id] = r.ops[id];
      }
      ops = freezeOps(keepOps);
    }
    if (notOwned && other(s.notOwnedCs)) {
      const from = this.dataOfCs(s.notOwnedCs ?? vanillaCs);
      const r = from || !versioned ? checkNotOwned(notOwned.filter((id) => sameOperator(from, id)), chess) : null;
      notOwned = r && !r.error ? Object.freeze(r.notOwned.slice()) : null;
    }
    if (diy && other(s.diyCs)) {
      const r = checkDiyPicks({ ...diy }, { data, kitted: this.kittedFor(room) });
      diy = r && 'ok' in r ? freezeDiy(r.picks) : null;
    }
    // 干员皮肤 (docs/SKINS.md): the skinId lives in a cosmetic overlay, not the content set, but the KEY is an operator
    // of this room. A charId the content does not have is dropped; a map that is no longer a plain charId→skinId
    // selection is left off the seat rather than handed to the match.
    let skins = null;
    if (s.skins && typeof s.skins === 'object') {
      const ids = operatorCharIds(data);
      const res = checkSkinSelection(s.skins, (id) => ids.has(id) || data.chess?.[id]?.isDiy === true);
      if (res.ok) skins = freezeSkins(res.skins, id => data.chess?.[id], id => ids.has(id));
    }
    return { loadout, ops, notOwned, diy, skins };
  }

  /**
   * Extra fields of every `welcome` (net.js): the operators a 自选 slot may field (shared/diy.js `kitted`) and the
   * server's content identity (header "Content identity").
   */
  welcomeInfo() {
    let info;
    if (!this.vanilla) info = { diyKitted: KITTED_CHARS };
    else {
      let n;
      try { n = Number(this.plugins?.unofficial?.()) || 0; } catch { n = 0; }
      info = { diyKitted: KITTED_CHARS, content: n > 0 ? { vanilla: this.vanilla.cs, plugins: n } : { vanilla: this.vanilla.cs } };
      // Catalogue metadata, never part of a room or match; omitted when no loaded plugin publishes a notice.
      if (this.plugins?.hasNotices?.()) info.content.notices = true;
    }
    // the official versions (header "Official versions"): only when the server offers more than 第二期下半, so a
    // welcome from a server narrowed to that version alone stays without `versions`
    let versions = null;
    try { versions = this.versions?.welcome?.() || null; } catch (e) { this.log.error('[lobby] the versions list failed', e); }
    if (versions) info.versions = versions;
    // Omitted when the switch is off, so a welcome from a normal server stays identical.
    if (this.testEnabled === true) info.testMode = true;
    return info;
  }

  // ---------------------------------------------------------------------------------------------------
  // Match wiring
  // ---------------------------------------------------------------------------------------------------

  /** @param {Room} room @param {string | null} [key] per-network limit key of the starter */
  startMatch(room, key = null) {
    return this.startMatchWith(room, key, null);
  }

  /**
   * Start a match, or rebuild one from a checkpoint (server/persist.js, docs/DEPLOY.md「断点续玩」).
   * A restored match re-enters the phase of its checkpoint (server/match/snapshot.js) instead of calling start(); its
   * battle ids continue above the interrupted ones. On a restore failure the room simply stays in the lobby.
   * @param {Room} room @param {string | null} key @param {object | null} checkpoint
   */
  startMatchWith(room, key, checkpoint, { departedPlayerIds = [] } = {}) {
    if (room.recoveryContentMissing || (checkpoint?.requireCs && checkpoint.cs !== room.content?.cs)) return fail(ERR.CONTENT_NOT_READY);
    if (room.test && !this.testEnabled) return fail(ERR.TEST_DISABLED);
    const versioned = room.version !== DEFAULT_VERSION;
    if (versioned && !this.versionHosts && this.MatchClass === DefaultMatch) return fail(ERR.INTERNAL, 'no match host for this version');
    if (room.versionVote) this.voidVersionVote(room, 'members');
    if (this.matchWorkerPool && !room.modded && !versioned) return this.startMatchWithWorker(room, key, checkpoint, { departedPlayerIds });
    return this.startMatchWithLocal(room, key, checkpoint, { departedPlayerIds });
  }

  async startMatchWithWorker(room, key, checkpoint, { departedPlayerIds = [] } = {}) {
    if (room.disposed || room.match) return fail(ERR.ROOM_STARTED);
    const host = room.seatOf(room.hostId);
    if (host && !checkpoint) host.ready = true;
    const seats = checkpoint
      ? checkpoint.players.map((p) => ({
        seat: p.seat, playerId: p.playerId, name: p.name, userId:p.userId || this.registry.byId(p.playerId)?.userId || null, avatarId:p.avatarId || null, publicId:p.publicId || null, isBot: !!p.isBot, connected: false,
        skins: p.isBot ? null : p.skins || null, loadout: p.isBot ? null : (p.loadout || null), ops: p.isBot ? null : p.ops || null, notOwned: p.isBot ? null : p.standIns || null, diy: p.isBot ? null : p.diy || null,
      }))
      : room.seats.filter(Boolean).map((s) => ({
        seat: s.seat, playerId: s.playerId, name: s.name, userId:this.registry.byId(s.playerId)?.userId || null, avatarId:s.avatarId || null, publicId:s.publicId || this.registry.byId(s.playerId)?.publicId || null, isBot: s.isBot, connected: s.connected,
        skins: s.isBot ? null : s.skins || null, loadout: s.isBot ? null : s.loadout || null, ops: s.isBot ? null : s.ops || null, notOwned: s.isBot ? null : s.notOwned || null, diy: s.isBot ? null : s.diy || null,
      }));
    const ctx = { live: false, ended: false, disposed: false, match: null, workerKey: room.code,
      lastPublic: null, sharedResult: null, results: new Map(), profileUsers:Object.fromEntries(seats.map(s=>[s.playerId,s.userId || this.registry.byId(s.playerId)?.userId || null])) };
    let seed = 0;
    try { seed = this.seedFn() >>> 0; } catch { seed = randomInt(2 ** 32); }
    if (checkpoint && Number.isInteger(checkpoint.seed)) seed = checkpoint.seed >>> 0;
    const matchNo = checkpoint ? Math.max(1, room.matchCount) : room.matchCount + 1;
    try {
      const match = await this.matchWorkerPool.create(room.code, {
        userPersistence:!!this.users, replayMaxBytes:this.replayMaxBytes || 0, roomCode: room.code, mode: room.mode, difficulty: room.difficulty, modeId: modeIdFor(room.mode, room.difficulty),
        seats, spectators: room.spectators.map((s) => s.playerId), consoleEnabled: !!room.consoleEnabled,
        hostId: room.hostId, ...(room.test === true ? { test: true } : {}), ...(room.content ? { cs: room.content.cs } : {}),
        seed, matchNo, aiPicksLast: !!room.aiPicksLast,
        prepSeconds: room.prepSeconds, prepMultiplier: room.prepMultiplier, combatSpeed: room.battleSpeed,
      }, {
        created: (match) => {
          ctx.match = match;
          ctx.live = true;
          room.match = match;
          room.matchCtx = ctx;
          room.matchKey = key;
        },
        send: (playerId, msg, encoded) => { if (ctx.live) return this.matchSend(room, ctx, playerId, msg, encoded); return false; },
        broadcast: (msg, encoded) => { if (ctx.live) this.matchBroadcast(room, ctx, msg, encoded); },
        end: (summary) => this.onMatchEnd(room, ctx, summary),
      }, checkpoint, departedPlayerIds);
      if (ctx.disposed || room.disposed || room.matchCtx !== ctx) {
        await match.dispose();
        return fail(ERR.NOT_IN_ROOM, 'match initialization cancelled');
      }
      room.replay = null;
      if (!checkpoint) room.matchCount++;
      ctx.live = true;
      this.broadcastState(room);
      if (checkpoint) {
        if (this.completeRecoveredMatch(ctx, room)) return OK;
        match._lastPubJson = '';
        await match.invoke('flush', true);
        this.log.info(`[lobby] ${room.code} match #${room.matchCount} restored in Worker (${room.mode}/${room.difficulty})`);
      } else {
        this.log.info(`[lobby] ${room.code} match #${room.matchCount} starting in Worker (${room.mode}/${room.difficulty}, ${seats.length} seats, seed ${seed})`);
        await match.start();
        if (!ctx.ended && !ctx.disposed) this.notifyMatchStarted(room.code, match);
      }
      return OK;
    } catch (e) {
      this.log.error(`[lobby] ${room.code} Worker match failed to start`, e);
      if (room.matchCtx === ctx) { room.match = null; room.matchCtx = null; room.matchKey = null; }
      this.disposeMatchCtx(ctx);
      this.broadcastState(room);
      return fail(ERR.INTERNAL, 'match failed to start');
    }
  }

  startMatchWithLocal(room, key, checkpoint, { departedPlayerIds = [] } = {}) {
    const data = this.dataFor(room);
    const modded = room.modded;
    const versioned = room.version !== DEFAULT_VERSION;
    const host = room.seatOf(room.hostId);
    if (host && !checkpoint) host.ready = true;
    const seats = checkpoint
      ? checkpoint.players.map((p) => ({
        seat: p.seat, playerId: p.playerId, name: p.name, userId:p.userId || this.registry.byId(p.playerId)?.userId || null, avatarId:p.avatarId || null, publicId:p.publicId || null, isBot: !!p.isBot, connected: false,
        skins: p.isBot ? null : p.skins || null, loadout: p.isBot ? null : (p.loadout || null), ops: p.isBot ? null : p.ops || null, notOwned: p.isBot ? null : p.standIns || null, diy: p.isBot ? null : p.diy || null,
      }))
      : room.seats.filter(Boolean).map((s) => ({
        seat: s.seat, playerId: s.playerId, name: s.name, userId:this.registry.byId(s.playerId)?.userId || null, avatarId:s.avatarId || null, publicId:s.publicId || this.registry.byId(s.playerId)?.publicId || null, isBot: s.isBot, connected: s.connected,
        // DESIGN §16: the human's checked operator loadout (bots fight with the defaults)
        skins: s.isBot ? null : s.skins || null, loadout: s.isBot ? null : s.loadout || null, ops: s.isBot ? null : s.ops || null, notOwned: s.isBot ? null : s.notOwned || null, diy: s.isBot ? null : s.diy || null,
      }));
    // lastPublic / results: the latest m.public broadcast and the m.result frames (encoded), kept for the replay.
    const ctx = { live: !checkpoint, ended: false, disposed: false, match: null, workerKey: room.code,
      lastPublic: null, sharedResult: null, results: new Map(), profileUsers:Object.fromEntries(seats.map(s=>[s.playerId,s.userId || this.registry.byId(s.playerId)?.userId || null])) };
    const matchNo = checkpoint ? Math.max(1, room.matchCount) : room.matchCount + 1;
    let seed = 0;
    try { seed = this.seedFn() >>> 0; } catch { seed = randomInt(2 ** 32); }
    if (checkpoint && Number.isInteger(checkpoint.seed)) seed = checkpoint.seed >>> 0;
    if (!checkpoint) for (const seat of seats) if (!seat.isBot) Object.assign(seat, this.seatSettings(room, room.seatOf(seat.playerId), data));
    try {
      const opts = {
        userPersistence:!!this.users, replayMaxBytes:this.replayMaxBytes || 0, roomCode: room.code,
        mode: room.mode,
        difficulty: room.difficulty,
        // a plugin mode the host chose (header "Gameplay plugins"), else the official mode of the difficulty
        modeId: room.content?.modeId || modeIdFor(room.mode, room.difficulty),
        // 「AI 队友最后选择」 (GitHub #338): fixed for the match
        aiPicksLast: room.mode !== 'solo' && room.aiPicksLast === true,
        seats,
        // the spectator seats (header): watched like eliminated players, never players
        spectators: room.spectators.map((s) => s.playerId),
        consoleEnabled: !!room.consoleEnabled,
        prepSeconds: room.prepSeconds,
        prepMultiplier: room.prepMultiplier,
        combatSpeed: room.battleSpeed,
        ...(room.test === true ? { test: true } : {}),
        seed,
        // the room's match number: with the seed it keeps battleIds unique across the room's matches (DESIGN §14)
        matchNo,
        data,
        hostId: room.hostId,
        ...(room.content ? { cs: room.content.cs } : {}),
        ...(room.content?.vs ? { vs: room.content.vs } : {}),
        ...(modded || versioned ? { requireCs: true } : {}),
        // another official version (header "Official versions"): its registry id; a default room's opts keep their keys
        ...(versioned ? { version: room.version } : {}),
        // 「不限时」 (header): only while the room's flag is on, so a default match's opts keep their keys
        ...(room.mode === 'solo' && room.soloUnlimited === true ? { soloUnlimited: true } : {}),
        // The list the lobby just checked the picks with (kittedFor). Vanilla rooms omit it: setDiy stays on
        // KITTED_CHARS, and the worker payload / test journal of a normal match do not grow a key.
        ...(modded ? { kitted: this.kittedFor(room) } : {}),
        ...(room.content?.rules ? { rules: room.content.rules } : {}),
        workerPool: modded || versioned ? null : this.workerPoolFor(room.code),
        log: this.log,
        now: this.now,
        // the server's own simulation pool (server/workers/roomPool.js) for bot rehearsals, when the operator started
        // one: null keeps every rehearsal on this thread, exactly as before (Match.simPool / MatchRehearsal.poolRehearsal)
        ...(!modded && !versioned && this.simPool ? { simPool: this.simPool } : {}),
        send: (playerId, msg, encoded) => (ctx.live ? this.matchSend(room, ctx, playerId, msg, encoded) : false),
        broadcast: (msg, encoded) => { if (ctx.live) this.matchBroadcast(room, ctx, msg, encoded); },
        onEnd: (summary) => this.onMatchEnd(room, ctx, summary),
      };
      // a room with gameplay plugins plays in its content set's match host, a room of another official version in that
      // version's; every other room here, as always
      const match = modded && this.hosts ? this.hosts.create(room.content.cs, opts)
        : versioned && this.versionHosts ? this.versionHosts.create(room.content.cs, opts)
          : new this.MatchClass(opts);
      ctx.match = match;
      if (checkpoint && match.hosted) {
        room.match = match;
        room.matchCtx = ctx;
        room.matchKey = key;
        ctx.live = true;
        return match.restoreCheckpoint(checkpoint, departedPlayerIds).then(ok => {
          if (!ok || room.disposed) {
            this.disposeMatchCtx(ctx);
            if (room.matchCtx === ctx) { room.match = null; room.matchCtx = null; }
            return fail(ERR.INTERNAL, 'plugin checkpoint refused');
          }
          this.broadcastState(room);
          this.notifyMatchStarted(room.code, match);
          return OK;
        });
      }
      if (checkpoint) {
        if (!applyMatchCheckpoint(match, checkpoint, { createRngFromState, log: this.log, bestEffort: true, departedPlayerIds })) {
          this.log.warn(`[lobby] ${room.code} match checkpoint refused — the room stays in the lobby`);
          this.disposeMatchCtx(ctx);
          this.broadcastState(room);
          return fail(ERR.INTERNAL, 'match checkpoint refused');
        }
        room.match = match;
        room.matchCtx = ctx;
        room.matchKey = key;
        room.replay = null;
        ctx.live = true;
        if (this.completeRecoveredMatch(ctx, room)) return OK;
        match._lastPubJson = '';
        match.flush?.(true);
        this.log.info(`[lobby] ${room.code} match #${room.matchCount} restored (${room.mode}/${room.difficulty}, round ${match.round}, ${match.phase})`);
        this.broadcastState(room);
        return OK;
      }
      room.match = match;
      room.matchCtx = ctx;
      room.matchKey = key;
      room.replay = null;
      room.matchCount++;
      this.log.info(`[lobby] ${room.code} match #${room.matchCount} starting (${room.mode}/${room.difficulty}, ${seats.length} seats, seed ${seed}${room.test ? ', test' : ''}${modded ? `, content ${room.content.cs.slice(0, 8)}${match.hosted ? ' in its match host' : ''}` : ''}${versioned ? `, version ${room.version}${match.hosted ? ' in its match host' : ''}` : ''})`);
      this.broadcastState(room);
      match.start();
      this.notifyMatchStarted(room.code, match);
    } catch (e) {
      this.log.error(`[lobby] ${room.code} match failed to start`, e);
      if (room.matchCtx === ctx) {
        resetAiTakeover(room);
        room.match = null; room.matchCtx = null; room.matchKey = null;
      }
      this.disposeMatchCtx(ctx);
      this.broadcastState(room);
      // the match hosts refuse one content set more than they run (PLUGIN_BUSY: server/match/host/index.js)
      return fail(e && isErrCode(e.code) ? e.code : ERR.INTERNAL, 'match failed to start');
    }
    return OK;
  }

  /** Start a match created by the matchmaking queue. Room members keep their room; individual queue members do not
   * acquire one, so the result screen returns them to the public lobby. */
  startQueuedMatch(owner, players, selected = [owner]) {
    if (players.some((p) => p.isBot)) return fail(ERR.BAD_MSG, 'matchmaking only accepts human players');
    if (this.accountSeatConflict(players)) return fail(ERR.ACCOUNT_ACTIVE);
    if (this.matchWorkerPool) return this.startQueuedMatchWorker(owner, players, selected);
    return this.startQueuedMatchLocal(owner, players, selected);
  }

  /** Reserve room and session ownership before the Worker init yields. */
  attachQueuedWorker(ctx, room, match) {
    ctx.match = match;
    ctx.live = true;
    this.activeQueueMatches.add(ctx);
    if (room) { room.match = match; room.matchCtx = ctx; }
    for (const p of ctx.members) if (!p.isBot && !p.left) {
      const session = this.registry.byId(p.playerId);
      if (session) session.activeMatchCtx = ctx;
    }
  }

  async startQueuedMatchWorker(owner, players, selected = [owner]) {
    const room = owner?.room || null;
    if (room && (room.disposed || room.match)) return fail(ERR.ROOM_STARTED);
    const used = new Set();
    const seats = players.map((p, i) => {
      let seat = Number.isInteger(p.seat) && p.seat >= 0 && p.seat < MAX_SEATS && !used.has(p.seat) ? p.seat : -1;
      if (seat < 0) { for (let j = 0; j < MAX_SEATS; j++) if (!used.has(j)) { seat = j; break; } }
      used.add(seat);
      return { ...p, userId:p.userId || this.registry.byId(p.playerId)?.userId || null, avatarId:p.avatarId || this.registry.byId(p.playerId)?.avatarId || null, publicId:p.publicId || this.registry.byId(p.playerId)?.publicId || null, seat, connected: p.isBot ? true : p.connected !== false };
    }).sort((a, b) => a.seat - b.seat);
    const allHumanIds = seats.filter((p) => !p.isBot).map((p) => p.playerId);
    const matchCode = room?.code || `M${randomBytes(3).toString('hex').toUpperCase()}`;
    const ctx = { live: false, ended: false, disposed: false, queue: true, match: null, workerKey: matchCode, room,
      members: seats, lastPublic: null, sharedResult: null, results: new Map(), profileUsers:Object.fromEntries(seats.map(s=>[s.playerId,s.userId || this.registry.byId(s.playerId)?.userId || null])) };
    let seed = 0;
    try { seed = this.seedFn() >>> 0; } catch { seed = randomInt(2 ** 32); }
    try {
      const match = await this.matchWorkerPool.create(matchCode, {
        userPersistence:!!this.users, replayMaxBytes:this.replayMaxBytes || 0, roomCode: matchCode, mode: owner.mode, difficulty: owner.difficulty, modeId: modeIdFor(owner.mode, owner.difficulty),
        seats, consoleEnabled: !!room?.consoleEnabled, aiPicksLast: !!room?.aiPicksLast, seed, matchNo: room ? room.matchCount + 1 : 1,
      }, {
        created: (match) => {
          this.attachQueuedWorker(ctx, room, match);
          for (const id of allHumanIds) {
            const session = this.registry.byId(id);
            if (session) session.pendingResult = null;
          }
          if (room) room.matchKey = this.registry.byId(room.hostId)?.limitKey || null;
        },
        send: (playerId, msg, encoded) => { if (ctx.live) return this.queueMatchSend(ctx, playerId, msg, encoded); return false; },
        broadcast: (msg, encoded) => { if (ctx.live) this.queueMatchBroadcast(ctx, msg, encoded); },
        end: (summary) => this.onQueuedMatchEnd(ctx, summary),
      });
      if (ctx.disposed || ctx.ended || room?.disposed || (room && room.matchCtx !== ctx)
        || !ctx.members.some((p) => !p.isBot && !p.left && this.registry.byId(p.playerId)?.activeMatchCtx === ctx)) {
        this.disposeMatchCtx(ctx);
        await match.dispose();
        return fail(ERR.NOT_IN_ROOM, 'match initialization cancelled');
      }
      if (room) {
        room.matchCount++; room.replay = null; this.broadcastState(room);
      }
      for (const entry of selected) this.sendQueueState(entry, 'matched');
      ctx.live = true;
      await match.start();
      if (!ctx.ended && !ctx.disposed) this.notifyMatchStarted(room?.code || `queue:${match.roomCode}`, match);
      return OK;
    } catch (e) {
      this.log.error(`[match] ${matchCode} matchmaking Worker start failed`, e);
      for (const id of allHumanIds) {
        const session = this.registry.byId(id);
        if (session?.activeMatchCtx === ctx) session.activeMatchCtx = null;
      }
      if (room && room.matchCtx === ctx) { room.match = null; room.matchCtx = null; room.matchKey = null; this.broadcastState(room); }
      this.disposeMatchCtx(ctx);
      if (room) this.disposeEmptyRoom(room);
      return fail(ERR.INTERNAL, 'match failed to start');
    }
  }

  startQueuedMatchLocal(owner, players, selected = [owner]) {
    const room = owner?.room || null;
    if (room && (room.disposed || room.match)) return fail(ERR.ROOM_STARTED);
    const used = new Set();
    const seats = players.map((p, i) => {
      let seat = Number.isInteger(p.seat) && p.seat >= 0 && p.seat < MAX_SEATS && !used.has(p.seat) ? p.seat : -1;
      if (seat < 0) { for (let j = 0; j < MAX_SEATS; j++) if (!used.has(j)) { seat = j; break; } }
      used.add(seat);
      return { ...p, userId:p.userId || this.registry.byId(p.playerId)?.userId || null, avatarId:p.avatarId || this.registry.byId(p.playerId)?.avatarId || null, publicId:p.publicId || this.registry.byId(p.playerId)?.publicId || null, seat, connected: p.isBot ? true : p.connected !== false };
    }).sort((a, b) => a.seat - b.seat);
    const allHumanIds = seats.filter((p) => !p.isBot).map((p) => p.playerId);
    const ctx = { live: true, ended: false, disposed: false, queue: true, match: null, workerKey: null, room, members: seats,
      lastPublic: null, sharedResult: null, results: new Map(), profileUsers:Object.fromEntries(seats.map(s=>[s.playerId,s.userId || this.registry.byId(s.playerId)?.userId || null])) };
    let seed = 0;
    try { seed = this.seedFn() >>> 0; } catch { seed = randomInt(2 ** 32); }
    const matchCode = room?.code || `M${randomBytes(3).toString('hex').toUpperCase()}`;
    ctx.workerKey = matchCode;
    try {
      const match = new this.MatchClass({
        userPersistence:!!this.users, replayMaxBytes:this.replayMaxBytes || 0, roomCode: matchCode,
        mode: owner.mode,
        difficulty: owner.difficulty,
        modeId: modeIdFor(owner.mode, owner.difficulty),
        seats,
        consoleEnabled: !!room?.consoleEnabled,
        aiPicksLast: !!room?.aiPicksLast,
        seed,
        matchNo: room ? room.matchCount + 1 : 1,
        data: this.safeData(), workerPool: this.workerPoolFor(matchCode), log: this.log, now: this.now,
        send: (playerId, msg, encoded) => (ctx.live ? this.queueMatchSend(ctx, playerId, msg, encoded) : false),
        broadcast: (msg, encoded) => { if (ctx.live) this.queueMatchBroadcast(ctx, msg, encoded); },
        onEnd: (summary) => this.onQueuedMatchEnd(ctx, summary),
      });
      ctx.match = match;
      this.activeQueueMatches.add(ctx);
      for (const id of allHumanIds) {
        const session = this.registry.byId(id);
        if (session) { session.activeMatchCtx = ctx; session.pendingResult = null; }
      }
      if (room) {
        room.match = match;
        room.matchCtx = ctx;
        room.matchKey = this.registry.byId(room.hostId)?.limitKey || null;
        room.matchCount++;
        room.replay = null;
        this.broadcastState(room);
      }
      for (const entry of selected) this.sendQueueState(entry, 'matched');
      this.log.info(`[match] ${matchCode} matchmaking start (${owner.mode}/${owner.difficulty}, ${seats.length} seats${room ? `, room ${room.code}` : ''})`);
      match.start();
      this.notifyMatchStarted(room?.code || `queue:${match.roomCode}`, match);
    } catch (e) {
      this.log.error(`[match] ${matchCode} matchmaking start failed`, e);
      for (const id of allHumanIds) {
        const session = this.registry.byId(id);
        if (session?.activeMatchCtx === ctx) session.activeMatchCtx = null;
      }
      if (room && room.matchCtx === ctx) { room.match = null; room.matchCtx = null; room.matchKey = null; this.broadcastState(room); }
      this.disposeMatchCtx(ctx);
      return fail(ERR.INTERNAL, 'match failed to start');
    }
    return OK;
  }

  recordUserResult(ctx,summary,room=null){
    const {replay,combat,...settlement}=summary || {};summary=settlement;
    if(!this.users || !summary?.matchId || !Array.isArray(summary.players))return;
    const frame={...summary,roomMode:room?.mode || (summary.modeId?.includes('_single_')?'solo':'coop'),
      content:room?.modded?{cs:room.content.cs,plugins:(room.content.plugins || []).map(p=>`${p.id}@${p.version}`)}:null};
    const rows=summary.players.filter(p=>!p.isBot).map(p=>({userId:ctx.profileUsers?.[p.playerId] || this.registry.byId(p.playerId)?.userId,
      playerId:p.playerId,victory:!!p.victory,rounds:Number(p.roundsPassed)||0,payload:{...p,frame:Object.fromEntries(Object.entries(frame).filter(([key])=>key!=='players'))}})).filter(p=>p.userId);
    if(!rows.length)return;
    if(!this.userOutbox.has(summary.matchId)){
      this.userOutbox.set(summary.matchId,{id:summary.matchId,endedAt:Date.now(),mode:summary.modeId || '',difficulty:summary.difficulty || '',source:'server',rows,replay,combat});
      this.onUserResultStaged?.();
    }
    this.flushUserResults();
  }

  flushUserResults(){
    if(!this.users)return;
    for(const [id,args] of this.userOutbox){
      if(this.userPendingIds.has(id))continue;
      this.userPendingIds.add(id);
      const task=(async()=>{
        for(let attempt=0;attempt<3;attempt++){
          try{await this.users.call('record',args);this.userOutbox.delete(id);return;}
          catch{if(attempt<2)await new Promise(r=>setTimeout(r,250));}
        }
        this.log.warn('[users] result save deferred; retained for retry');
      })();
      this.userWrites.add(task);task.finally(()=>{this.userWrites.delete(task);this.userPendingIds.delete(id);});
    }
  }

  notifyMatchStarted(key, match) {
    try { this.onMatchStarted?.({ key, match }); }
    catch (e) { this.log.warn(`[persist] ${key}: initial checkpoint notification failed (${e.message})`); }
  }

  queueMatchSend(ctx, playerId, msg, encoded = null) {
    if (!ctx || ctx.disposed) return false;
    const p = ctx.members.find((x) => x.playerId === playerId);
    if (!p || p.isBot || p.left) return false;
    // Settlement belongs to an offline teammate too; keep their encoded result before checking the socket.
    if (msg?.t === 'm.result') ctx.results.set(playerId, encoded ?? encode(msg));
    const session = this.registry.byId(playerId);
    if (!session || !session.connected || session.activeMatchCtx !== ctx) return false;
    return sendSession(session, msg, encoded);
  }

  queueMatchBroadcast(ctx, msg, encoded = null) {
    if (!ctx || ctx.disposed) return null;
    const data = encoded ?? encode(msg);
    if (data == null) return null;
    if (msg?.t === 'm.public') ctx.lastPublic = data;
    else if (msg?.t === 'm.result') ctx.sharedResult = data;
    for (const p of ctx.members) if (!p.isBot && !p.left) {
      const session = this.registry.byId(p.playerId);
      if (session?.connected && session.activeMatchCtx === ctx) sendSession(session, msg, data);
    }
    return data;
  }

  onQueuedMatchEnd(ctx, summary) {
    if (!ctx || ctx.ended || !ctx.live) return;
    this.recordUserResult(ctx,summary);
    if(summary){summary={...summary};delete summary.replay;}
    const room = ctx.room;
    for (const p of ctx.members) if (!p.isBot) {
      const session = this.registry.byId(p.playerId);
      if (session?.activeMatchCtx === ctx) {
        if (!p.left && session.connected) session.lastMatchAt = this.now();
        // External teammates cannot use the owning room's replay (and it may be emptied at settlement).
        if (!p.left && (!room || !room.seatOf(p.playerId))) {
          const result = ctx.results.get(p.playerId) || ctx.sharedResult;
          if (result) session.pendingResult = [ctx.lastPublic, result].filter(Boolean);
        }
        // A matched player may still own a different lobby room; only detach the ended match.
        session.activeMatchCtx = null;
      }
    }
    if (room) {
      // onMatchEnd owns the room replay/lobby transition and its exactly-once guard.
      this.onMatchEnd(room, ctx, summary);
      return;
    }
    ctx.ended = true;
    ctx.live = false;
    this.log.info(`[match] standalone matchmaking match ended (${ctx.members.length} seats)`);
    setImmediate(() => this.disposeMatchCtx(ctx));
  }

  /** onEnd callback: return the room to LOBBY and dispose the match on the next macrotask. */
  onMatchEnd(room, ctx, summary) {
    if (ctx.ended || !ctx.live || room.matchCtx !== ctx || room.disposed) return;
    this.recordUserResult(ctx,summary,room);
    if(summary){summary={...summary};delete summary.replay;}
    ctx.ended = true;
    room.lastSummary = summary ?? null;
    resetAiTakeover(room);
    room.match = null;
    room.matchCtx = null;
    room.matchKey = null;
    room.replay = this.buildReplay(room, ctx);
    setImmediate(() => this.disposeMatchCtx(ctx));
    // a match of gameplay plugins, or of an official version, whose match host stopped (header "Gameplay plugins",
    // "Official versions"; its members were told: proxy.js)
    const why = summary && typeof summary.reason === 'string' && /^(?:plugin|version)-/.test(summary.reason) ? ` (${summary.reason}${summary.detail ? `: ${summary.detail}` : ''})` : '';
    this.log.info(`[lobby] ${room.code} match #${room.matchCount} ended${why}`);
    for (let i = 0; i < room.seats.length; i++) {
      const s = room.seats[i];
      if (!s || s.isBot) continue;
      if (s.left) { room.seats[i] = null; continue; }
      const session = this.registry.byId(s.playerId);
      if (session?.connected) session.lastMatchAt = this.now();
      s.ready = false;
      if (!s.connected) this.startGrace(room, s);
    }
    for (const s of room.spectators) if (!s.connected) this.startGrace(room, s);
    const host = room.hostId ? room.seatOf(room.hostId) : null;
    if (!host || host.isBot || host.left) this.migrateHost(room);
    if (room.activeHumans().length === 0) this.disposeRoom(room, 'empty');
    else {
      this.broadcastState(room);
      // its plugins changed on disk during the match: the host can apply them again now
      if (room.pluginsChanged) this.tellPluginsChanged(room);
    }
  }

  /** Match unicast; m.result frames are also kept for the replay. */
  matchSend(room, ctx, playerId, msg, encoded = null) {
    if (msg && msg.t === 'm.result') {
      const data = encoded ?? encode(msg);
      if (data != null) ctx.results.set(playerId, data);
    }
    return this.sendToPlayer(room, playerId, msg, encoded);
  }

  /** Match broadcast; the latest m.public and a broadcast m.result are also kept for the replay. */
  matchBroadcast(room, ctx, msg, encoded = null) {
    if (msg.t === 'm.public' && reconcileAiTakeover(this, room)) this.broadcastState(room);
    const data = this.broadcastRoom(room, msg, encoded);
    if (data == null) return;
    if (msg.t === 'm.public') ctx.lastPublic = data;
    else if (msg.t === 'm.result') ctx.sharedResult = data;
  }

  /**
   * Replay record for the humans still seated when a match ends (null when the match produced no m.result,
   * e.g. it was abandoned: those clients then see "simulation closed").
   * @param {Room} room @returns {Room['replay']}
   */
  buildReplay(room, ctx) {
    const frames = new Map();
    for (const s of [...room.seats, ...room.spectators]) {
      if (!s || s.isBot || s.left) continue;
      const frame = ctx.results.get(s.playerId) || ctx.sharedResult;
      if (frame) frames.set(s.playerId, frame);
    }
    if (frames.size === 0) return null;
    return { publicFrame: ctx.lastPublic, frames, pending: new Set(frames.keys()) };
  }

  /** The replay frames still owed to a player (null when they moved on). @returns {string[] | null} */
  replayFor(room, playerId) {
    const r = room.replay;
    if (!r || !r.pending.has(playerId)) return null;
    return [r.publicFrame, r.frames.get(playerId)].filter(Boolean);
  }

  /** The player moved on from the result screen (acted in the room, left): stop replaying it. */
  dropReplay(room, playerId) {
    const r = room.replay;
    if (!r || !r.pending.delete(playerId)) return;
    r.frames.delete(playerId);
    if (r.pending.size === 0) room.replay = null;
  }

  /**
   * The heavy part of a resync — full match state (match.onReconnect) or, back in LOBBY, the result replay.
   * Immediate after a (re)connect; for repeated hellos on a live socket at most once per resyncMinGapMs
   * (requests inside the window coalesce into one deferred resync).
   * @param {import('./net.js').Session} session @param {boolean} coalesce
   */
  resync(session, coalesce) {
    const pid = session.playerId;
    if (coalesce) {
      if (this.resyncTimers.has(pid)) return; // the scheduled resync answers this request too
      const wait = (Number.isFinite(session.resyncAt) ? session.resyncAt : -Infinity) + this.opts.resyncMinGapMs - this.now();
      if (wait > 0) {
        const t = setTimeout(() => { this.resyncTimers.delete(pid); this.runResync(session); }, wait);
        t.unref?.();
        this.resyncTimers.set(pid, t);
        return;
      }
    } else {
      this.clearResync(pid);
    }
    this.runResync(session);
  }

  /** @param {import('./net.js').Session} session */
  runResync(session) {
    if (!session.connected || this.registry.byId(session.playerId) !== session) return;
    resetStateDelta(session.ws);
    const room = this.roomOf(session);
    const active = this.activeMatchOf(session);
    if (active?.match && (!room || active.queue)) {
      session.resyncAt = this.now();
      this.callMatchContext(active, 'onReconnect', session.playerId);
      return;
    }
    if (!room) return;
    // in order with the room's messages when its match runs in a match host (header "Gameplay plugins")
    if (this.queuedRoom(session)) { this.queueEvent(room, () => this.resyncNow(session)); return; }
    this.resyncNow(session);
  }

  /** runResync, now. @param {import('./net.js').Session} session */
  resyncNow(session) {
    if (!session.connected || this.registry.byId(session.playerId) !== session) return;
    const room = this.roomOf(session);
    if (!room) return;
    session.resyncAt = this.now();
    if (room.match) {
      this.callMatch(room, room.spectatorOf(session.playerId) ? 'addSpectator' : 'onReconnect', session.playerId);
      return;
    }
    const frames = this.replayFor(room, session.playerId);
    if (frames) for (const frame of frames) sendSession(session, JSON.parse(frame), frame);
  }

  clearResync(playerId) {
    const t = this.resyncTimers.get(playerId);
    if (t) { clearTimeout(t); this.resyncTimers.delete(playerId); }
  }

  /** Log a per-network limit refusal without letting a refusal loop flood the log. */
  limitWarn(text) {
    const now = this.now();
    if (now - this.limitLog.at < 10_000) { this.limitLog.suppressed++; return; }
    const more = this.limitLog.suppressed ? ` (+${this.limitLog.suppressed} similar refusals)` : '';
    this.limitLog.at = now;
    this.limitLog.suppressed = 0;
    this.log.warn(`[lobby] ${text}${more}`);
  }

  /** A warning logged once per text (the default plugins that cannot be applied …). @param {string} line */
  warnOnce(line) {
    if (this.told.has(line)) return;
    if (this.told.size < 256) this.told.add(line);
    this.log.warn(line);
  }

  /** Number of rooms matching a predicate. */
  countRooms(pred) {
    let n = 0;
    for (const r of this.rooms.values()) if (pred(r)) n++;
    return n;
  }

  /**
   * Route a 'g.*' intent or a 'b.*' report (server/net.js) to the running match — on the room's queue when its match runs
   * in a match host (header "Gameplay plugins").
   */
  routeGame(session, msg) {
    if (msg.t === 'g.chat' && this.nameModeration?.checkChat) {
      if (!validChatText(msg.text)) return fail(ERR.BAD_MSG);
      const active = this.activeMatchOf(session);
      const room = this.roomOf(session);
      const match = active?.match || room?.match;
      if (!match || (room && room.spectatorOf(session.playerId))) return this.routeGameUnchecked(session, msg);
      if (this.chatReviews.has(session)) return fail(ERR.RATE);
      const socket = session.ws;
      const text = msg.text.trim();
      // Bind the reviewed bytes to this session, socket and Match generation. A late verdict
      // must never follow a player into a new game, a replacement tab or a reconnect.
      const review = Promise.resolve().then(() => this.nameModeration.checkChat(text, session.limitKey || '?'))
        .catch(() => ({ allowed: true }));
      this.chatReviews.set(session, review);
      return review.then((result) => {
        const current = this.activeMatchOf(session);
        if (this.shuttingDown || !session.connected || this.registry.byId(session.playerId) !== session
          || session.ws !== socket || current?.match !== match || current.disposed || current.ended
          || match.disposed || match.ended) return fail(ERR.WRONG_PHASE);
        if (result?.allowed !== true && [ERR.NAME_REJECTED, ERR.BAD_MSG].includes(result?.code)) {
          // Never log message content/identity, attempts, approvals, format errors or fail-open results.
          if (result.code === ERR.NAME_REJECTED) this.log.info?.('[chat] moderation rejected in-match message');
          return fail(result.code === ERR.BAD_MSG ? ERR.BAD_MSG : ERR.CHAT_REJECTED);
        }
        return this.routeGameUnchecked(session, { ...msg, text });
      }).finally(() => { if (this.chatReviews.get(session) === review) this.chatReviews.delete(session); });
    }
    return this.routeGameUnchecked(session, msg);
  }

  routeGameUnchecked(session, msg) {
    const room = this.queuedRoom(session);
    return room ? this.serial(room, () => this.routeGameNow(session, msg)) : this.routeGameNow(session, msg);
  }

  routeGameNow(session, msg) {
    const active = this.activeMatchOf(session);
    const room = this.roomOf(session);
    const match = active?.match || room?.match;
    if (!match) return room ? fail(ERR.WRONG_PHASE, 'no running match') : fail(ERR.NOT_IN_ROOM);
    if (msg.t === 'g.test') {
      if (!this.testEnabled) return fail(ERR.TEST_DISABLED);
      if (!room?.test) return fail(ERR.TEST_FORBIDDEN);
    }
    if (msg.t === 'g.leave') {
      if (active?.queue && !active.room?.seatOf(session.playerId)) this.leaveQueuedMatchPlayer(active, session.playerId);
      else if (active?.queue) this.removeMember(active.room, session.playerId);
      else this.removeMember(room, session.playerId);
      return OK;
    }
    // a spectator only watches (header): nothing else of it ever reaches the match
    if (room && msg.t !== 'g.watch' && !(room.test && msg.t === 'g.test') && room.spectatorOf(session.playerId)) return fail(ERR.SPECTATOR);
    let res;
    try {
      res = match.handle(session.playerId, msg);
      if (room && reconcileAiTakeover(this, room)) this.broadcastState(room);
    } catch (e) {
      this.log.error(`[lobby] ${(room?.code || active?.match?.roomCode || 'queue')} match.handle(${msg.t}) threw`, e);
      return fail(ERR.INTERNAL);
    }
    if (res && typeof res.then === 'function' && match.remote) {
      return Promise.resolve(res).then((value) => {
        if (value && typeof value === 'object' && value.error) {
          return fail(isErrCode(value.error) ? value.error : ERR.INTERNAL, typeof value.detail === 'string' ? value.detail : undefined);
        }
        return OK;
      }).catch((e) => {
        const matchLabel = room?.code || active?.match?.roomCode || 'queue';
        this.log.error(`[lobby] ${matchLabel} async match.handle(${msg.t}) rejected`, e);
        return fail(ERR.INTERNAL);
      });
    }
    if (res && typeof res.then === 'function') {
      // a match in a match host answers later (header "Gameplay plugins"): the reply waits for it
      if (room.match?.hosted === true) {
        return Promise.resolve(res).then((r) => matchAnswer(r), (e) => {
          this.log.error(`[lobby] ${room.code} match.handle(${msg.t}) rejected`, e);
          return fail(ERR.INTERNAL);
        });
      }
      const matchLabel = room?.code || active?.match?.roomCode || 'queue';
      this.log.error(`[lobby] ${matchLabel} match.handle(${msg.t}) returned a Promise; it must be synchronous`);
      Promise.resolve(res).catch((e) => this.log.error(`[lobby] ${matchLabel} match.handle(${msg.t}) rejected`, e));
      return OK;
    }
    return matchAnswer(res);
  }

  /** Server-owned participation, excluding spectators and players who left. */
  hasActiveMatch(session) {
    const ctx = this.activeMatchOf(session);
    if (!ctx || ctx.ended || !ctx.match || ctx.match.phase === 'ENDED') return false;
    // Match members exclude spectators, AI seats and players who explicitly left.
    const members = ctx.match.order || ctx.members || this.roomOf(session)?.seats || [];
    return members.some((p) => p && p.playerId === session.playerId && !p.isBot && !p.left);
  }

  /** Match context for both room-bound queue matches and standalone queue matches. */
  activeMatchOf(session) {
    const ctx = session?.activeMatchCtx;
    if (ctx && ctx.match && !ctx.disposed) return ctx;
    const room = session ? this.roomOf(session) : null;
    if (room?.match && room.matchCtx) return room.matchCtx;
    return null;
  }

  callMatchContext(ctx, method, ...args) {
    if (!ctx?.match) return undefined;
    const fn = ctx.match[method] || (method === 'onLeave' ? ctx.match.onDisconnect : null);
    if (typeof fn !== 'function') return undefined;
    try {
      const result = fn.apply(ctx.match, args);
      if (result && typeof result.then === 'function') {
        result.catch((e) => this.log.error(`[lobby] ${ctx.match.roomCode || 'queue'} ${method} rejected`, e));
      }
      return result;
    } catch (e) {
      this.log.error(`[lobby] ${ctx.match.roomCode || 'queue'} ${method} threw`, e);
      return undefined;
    }
  }

  leaveQueuedMatchPlayer(ctx, playerId) {
    const member = ctx.members?.find((p) => p.playerId === playerId);
    if (!member || member.isBot || member.left || ctx.disposed) return;
    // Main-thread membership is authoritative even before a Worker acknowledges onLeave.
    member.left = true;
    member.connected = false;
    this.holdRoomDeparture(ctx.room,this.callMatchContext(ctx, 'onLeave', playerId));
    const session = this.registry.byId(playerId);
    if (session?.activeMatchCtx === ctx) session.activeMatchCtx = null;
    if (ctx.room) this.disposeEmptyRoom(ctx.room);
  }

  /** Call an optional match hook without letting it throw. onLeave falls back to onDisconnect. */
  callMatch(room, method, ...args) {
    const m = room.match;
    if (!m) return undefined;
    let fn = m[method];
    if (typeof fn !== 'function' && method === 'onLeave') fn = m.onDisconnect;
    if (typeof fn !== 'function') return undefined;
    try {
      const result = fn.apply(m, args);
      if (result && typeof result.then === 'function') {
        result.catch((e) => this.log.error(`[lobby] ${room.code} match.${method} rejected`, e));
      }
      return result;
    } catch (e) {
      this.log.error(`[lobby] ${room.code} match.${method} threw`, e);
      return undefined;
    }
  }

  disposeMatchCtx(ctx) {
    if (ctx.disposed) return;
    ctx.disposed = true;
    ctx.live = false;
    this.activeQueueMatches.delete(ctx);
    // A room can close without onQueuedMatchEnd (empty, shutdown, failure). Surviving sessions must not own its
    // disposed Match/fields through activeMatchCtx, including guests matched from another party.
    for (const session of this.registry.all()) {
      if (session.activeMatchCtx === ctx) session.activeMatchCtx = null;
    }
    try { ctx.match?.dispose?.(); } catch (e) { this.log.error('[lobby] match.dispose threw', e); }
    const key = ctx.workerKey || ctx.match?.roomCode || ctx.room?.code;
    if (key && this.workerPool?.release) this.workerPool.release(key);
    if (key && ctx.match && this.matchWorkerPool?.release) this.matchWorkerPool.release(key, ctx.match);
  }

  safeData() {
    try { return this.getData(); } catch (e) { this.log.error('[lobby] getData failed', e); return Object.freeze({}); }
  }

  /** How long a dropped solo run stays resumable (ms): an explicit option, else this branch's 6-hour default. */
  soloResumeWindowMs(room = null) {
    const o = this.opts.soloReconnectWindowMs;
    if (typeof o === 'number' && Number.isFinite(o) && o > 0) return o;
    if (o === null) {
      const seconds = (room ? this.dataFor(room) : this.safeData())?.config?.constants?.singleReconnectTime;
      if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
    }
    return SOLO_RECONNECT_FALLBACK_SEC * 1000;
  }

  // ---------------------------------------------------------------------------------------------------
  // Membership helpers
  // ---------------------------------------------------------------------------------------------------

  /** One profile may play several matches, but only once in any given room or selected team.
   * Disconnected seats still count. Profiles stay private: public snapshots never contain account identifiers.
   */
  accountSeatConflict(players) {
    const accounts = new Set();
    for (const player of players) {
      const session = this.registry?.byId(player.playerId);
      const userId = session?.userId;
      if (!userId || player.isBot) continue;
      if (accounts.has(userId)) return true;
      accounts.add(userId);
    }
    return false;
  }

  /** The session's current room (self-heals stale `roomCode`). @returns {Room | null} */
  roomOf(session) {
    if (!session.roomCode) return null;
    const room = this.rooms.get(session.roomCode);
    const seat = room ? room.seatOf(session.playerId) : null;
    if (room && !seat && room.spectatorOf(session.playerId)) return room; // a spectator seat
    if (!room || !seat || seat.left || seat.isBot) { session.roomCode = null; return null; }
    return room;
  }

  /**
   * A human seat for `session` in `room`. The card is checked against the room's operators (header 名片干员): one the
   * room's content lacks is left off the seat, never cleared from the session.
   * @param {number} idx @param {any} session @param {Room} room
   * @returns {Seat}
   */
  humanSeat(idx, session, room) {
    const checkedCard = session.card ? cleanPlayerCard(session.card, id => opsCharIds(this.dataFor(room)).has(id)) : null;
    const card = checkedCard && (checkedCard.charId || checkedCard.avatar) ? checkedCard : null;
    return {
      seat: idx, playerId: session.playerId, name: session.name, avatarId:session.avatarId || null, publicId:session.publicId || null, isBot: false, ready: false, connected: session.connected, left: false,
      skins: session.skins || null,
      card,
      loadout: session.loadout || null,
      ops: session.ops || null,
      notOwned: session.notOwned || null,
      diy: session.diy || null,
      // 干员皮肤 (docs/SKINS.md): the appearances this player wears, keyed by operator charId (PUBLIC: the match
      // publishes them to teammates)

      // 名片干员 (room.card): the operator on this player's seat card (PUBLIC: room.state seats[].card)

      // the content each was checked for (header "Gameplay plugins": filtered at the match start when it is another)
      loadoutCs: session.loadoutCs ?? null,
      notOwnedCs: session.notOwnedCs ?? null,
      diyCs: session.diyCs ?? null,
    };
  }

  /**
   * Remove a human from a room permanently (leave, grace timeout, expiry, switching rooms).
   * In LOBBY the seat is freed; during a match it is marked departed and match.onLeave is called.
   * @param {Room} room @param {string} playerId
   */
  removeMember(room, playerId) {
    const session = this.registry.byId(playerId);
    const active = session?.activeMatchCtx;
    if (session && session.roomCode === room.code) session.roomCode = null;
    this.clearGrace(playerId);
    this.dropReplay(room, playerId);
    if (this.freeSpectatorSeat(room, playerId)) return;
    const seat = room.seatOf(playerId);
    if (!seat || seat.isBot || seat.left || room.disposed) return;
    if (room.match) {
      seat.left = true;
      seat.connected = false;
      seat.ready = false;
      if (room.matchCtx?.queue) this.leaveQueuedMatchPlayer(room.matchCtx, playerId);
      else this.holdRoomDeparture(room,this.callMatch(room, 'onLeave', playerId));
      if (session?.activeMatchCtx === room.matchCtx) session.activeMatchCtx = null;
    } else {
      room.seats[seat.seat] = null;
      if (active?.queue) this.leaveQueuedMatchPlayer(active, playerId);
      // a player seat freed: the version vote is void (header "Official versions")
      if (room.versionVote) this.voidVersionVote(room, 'members');
    }
    if (room.disposed) return; // onLeave may have ended the match and emptied the room
    if (room.hostId === playerId) this.migrateHost(room);
    this.disposeEmptyRoom(room);
    if (!room.disposed) this.broadcastState(room);
  }

  /** An empty party is not an empty match: retain the original code/lane while external humans still own it. */
  holdRoomDeparture(room,result){
    if(!room || !room.matchCtx?.live || room.match?.ready===false || !result || typeof result.then!=='function')return;
    room.pendingDepartures=(room.pendingDepartures || 0)+1;
    const done=()=>{room.pendingDepartures--;this.disposeEmptyRoom(room);};
    result.then(done,done);
  }

  disposeEmptyRoom(room) {
    if(room.pendingDepartures)return;
    if (room.disposed || room.activeHumans().length) return;
    const ctx = room.matchCtx;
    if (ctx?.queue && !ctx.ended && !ctx.disposed && ctx.members.some((p) =>
      !p.isBot && !p.left && this.registry.byId(p.playerId)?.activeMatchCtx === ctx)) return;
    this.disposeRoom(room, 'empty');
  }

  /**
   * Free a spectator seat (removeMember): the match forgets the spectator; never a host change or a disposal — a
   * spectator neither holds the host nor keeps a room alive. @returns {boolean} true when it was a spectator seat
   */
  freeSpectatorSeat(room, playerId) {
    const i = room.spectators.findIndex((s) => s.playerId === playerId);
    if (i < 0) return false;
    room.spectators.splice(i, 1);
    if (room.disposed) return true;
    this.callMatch(room, 'removeSpectator', playerId);
    this.broadcastState(room);
    return true;
  }

  /** Lowest-seat connected human becomes host (else lowest-seat human, else null). */
  migrateHost(room) {
    const humans = room.activeHumans();
    const pick = humans.find((s) => s.connected) || humans[0] || null;
    const prev = room.hostId;
    room.hostId = pick ? pick.playerId : null;
    if (pick && prev !== pick.playerId) this.log.info(`[lobby] ${room.code} host → ${pick.name}`);
    // a host change voids the version vote (header "Official versions") — defensive: while a vote is open (no match) the
    // host only changes by leaving, kick or grace timeout, whose freed seat voided it already (removeMember)
    if (room.hostId !== prev && room.versionVote) this.voidVersionVote(room, 'members');
    // a running match follows the host change: its delegated bot rehearsals fall back to the server and later ones ask
    // the new host (DESIGN §14, Match.setHost)
    if (room.match && room.hostId !== prev) this.callMatch(room, 'setHost', room.hostId);
  }

  startGrace(room, seat) {
    const playerId = seat.playerId;
    this.clearGrace(playerId);
    const t = setTimeout(() => {
      this.graceTimers.delete(playerId);
      if (room.disposed || room.match) return;
      const s = room.seatOf(playerId) || room.spectatorOf(playerId);
      if (!s || s.connected) return;
      const session = this.registry.byId(playerId);
      if (session && session.roomCode === room.code) {
        session.notice = 'timeout';
        session.pendingResult = this.replayFor(room, playerId); // still shown after room.closed on resume
      }
      this.removeMember(room, playerId);
    }, this.opts.lobbyGraceMs);
    t.unref?.();
    this.graceTimers.set(playerId, t);
  }

  clearGrace(playerId) {
    const t = this.graceTimers.get(playerId);
    if (t) { clearTimeout(t); this.graceTimers.delete(playerId); }
  }

  /**
   * Delete a room, detach its members (room.closed unless the room simply emptied) and dispose its match.
   * @param {Room} room @param {string} reason
   */
  disposeRoom(room, reason) {
    if (room.disposed) return;
    room.disposed = true;
    if (this.rooms.get(room.code) === room) { this.trustedRuntime?.event('roomClosed',{room:room.toState(this.now())}); this.rooms.delete(room.code); }
    // an open version vote ends with the room (its timer)
    if (room.versionVote) { clearTimeout(room.versionVote.timer); room.versionVote = null; }
    const ctx = room.matchCtx;
    resetAiTakeover(room);
    room.match = null;
    room.matchCtx = null;
    room.matchKey = null;
    room.replay = null;
    for (const s of room.seats) {
      if (!s || s.isBot) continue;
      this.clearGrace(s.playerId);
      const session = this.registry.byId(s.playerId);
      if (!session || session.roomCode !== room.code) continue;
      session.roomCode = null;
      if (s.left || reason === 'empty') continue;
      if (session.connected) sendSession(session, { t: 'room.closed', reason });
      else session.notice = reason;
    }
    // spectators did not leave: they are told whatever closed the room (its last human leaving included)
    for (const s of room.spectators) {
      this.clearGrace(s.playerId);
      const session = this.registry.byId(s.playerId);
      if (!session || session.roomCode !== room.code) continue;
      session.roomCode = null;
      if (session.connected) sendSession(session, { t: 'room.closed', reason });
      else session.notice = reason;
    }
    if (ctx) this.disposeMatchCtx(ctx);
    // the room's visual set and content set are no longer held by it (server/plugins/visualSet.js, contentSets.js)
    this.releaseContent(room.content);
    this.log.info(`[lobby] ${room.code} disposed (${reason})`);
  }

  genCode(yieldingRoom = null) {
    // create() may reuse its caller's sole-human room only after validation; no membership changes here.
    const fixed = this.opts.roomCode || null;
    if (fixed) return this.rooms.has(fixed) && this.rooms.get(fixed) !== yieldingRoom ? null : fixed;
    for (let attempt = 0; attempt < 1000; attempt++) {
      let code = '';
      for (let i = 0; i < ROOM_CODE_LEN; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
      if (!this.rooms.has(code)) return code;
    }
    return null;
  }

  // ---------------------------------------------------------------------------------------------------
  // Sending
  // ---------------------------------------------------------------------------------------------------

  /** Connected, non-departed human sessions of a room — its spectators included (room.state, match broadcasts). */
  *memberSessions(room) {
    for (const s of [...room.seats, ...room.spectators]) {
      if (!s || s.isBot || s.left) continue;
      const session = this.registry.byId(s.playerId);
      if (session && session.connected && session.roomCode === room.code) yield session;
    }
  }

  broadcastState(room) {
    if (room.disposed) return;
    reconcileAiTakeover(this, room);
    if (this.trustedRuntime) {
      const state = room.toState(this.now()), prev = room.trustedPrevious;
      const event = (name,extra={}) => this.trustedRuntime.event(name,{room:state,...extra});
      if (!prev) event('roomCreated');
      const before = new Set((prev?.seats || []).filter(Boolean).map(s => s.playerId));
      const after = new Set(state.seats.filter(Boolean).map(s => s.playerId));
      for (const id of after) if (!before.has(id)) event('playerJoined',{playerId:id});
      for (const id of before) if (!after.has(id)) event('playerLeft',{playerId:id});
      if (state.inMatch && !prev?.inMatch) event('matchStarted');
      room.trustedPrevious = state;
    }
    const data = encode(room.toState(this.now()));
    for (const session of this.memberSessions(room)) sendRaw(session.ws, data);
  }

  sendState(room, session) {
    sendSession(session, room.toState(this.now()));
  }

  /** Match broadcast: encode once, send to every connected member. @returns {string | null} the encoded frame */
  broadcastRoom(room, msg, encoded = null) {
    if (room.disposed) return null;
    const data = encoded ?? encode(msg);
    if (data == null) { this.log.error(`[lobby] ${room.code} unserializable broadcast ${msg && msg.t}`); return null; }
    // per connection: sendSession runs the state transport, which owns each socket's delta baseline (and the
    // droppable/backpressure rules) - one shared byte string in, one frame per member out
    for (const session of this.memberSessions(room)) sendSession(session, msg, data);
    return data;
  }

  /** Match unicast. @returns {boolean} */
  sendToPlayer(room, playerId, msg, encoded = null) {
    if (room.disposed) return false;
    const seat = room.seatOf(playerId) || room.spectatorOf(playerId);
    if (!seat || seat.isBot || seat.left) return false;
    const session = this.registry.byId(playerId);
    if (!session || session.roomCode !== room.code) return false;
    return sendSession(session, msg, encoded);
  }
}
