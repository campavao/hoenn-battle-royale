#ifndef GUARD_RECORDED_BATTLE_H
#define GUARD_RECORDED_BATTLE_H

extern u32 gRecordedBattleRngSeed;
extern u32 gBattlePalaceMoveSelectionRngValue;
extern u8 gRecordedBattleMultiplayerId;

#define B_RECORD_MODE_RECORDING 1
#define B_RECORD_MODE_PLAYBACK 2

void RecordedBattle_Init(u8 mode);
void RecordedBattle_SetTrainerInfo(void);
void RecordedBattle_SetBattlerAction(u8 battler, u8 action);
void RecordedBattle_ClearBattlerAction(u8 battler, u8 bytesToClear);
u8 RecordedBattle_GetBattlerAction(u8 battler);
u8 RecordedBattle_BufferNewBattlerData(u8 *dst);
void RecordedBattle_RecordAllBattlerData(u8 *src);
#if BR
u8 RecordedBattle_BufferSpectateDelta(u8 *dst, u8 cap); // POK-233: the spectator action stream
struct Pokemon;
void RecordedBattle_StartSpectate(u32 seed, u32 flags, struct Pokemon *pParty,
    struct Pokemon *eParty, const u8 *names, const u8 *genders, void (*CB2_After)(void));
// Appends one streamed delta ([battler, count, bytes...] runs, `n` bytes of them) to
// the record the replay reads from. Its own write cursor, so it never disturbs the read.
void RecordedBattle_FeedSpectate(const u8 *delta, u8 n);
// TRUE when `count` more action bytes have arrived for this battler -- the spectator's
// controllers hold their turn until they have, so the replay waits a turn behind -- or
// the stream has ended, and nothing more will.
bool8 RecordedBattle_HasBattlerAction(u8 battler, u8 count);
// The fight is over on the fighters' side: let the replay finish what it has and quit
// instead of waiting for a turn that will never come.
void RecordedBattle_EndSpectate(void);
bool8 RecordedBattle_IsSpectateLive(void);
#endif
bool32 CanCopyRecordedBattleSaveData(void);
bool32 MoveRecordedBattleToSaveData(void);
void PlayRecordedBattle(void (*CB2_After)(void));
u8 GetRecordedBattleFrontierFacility(void);
u8 GetRecordedBattleFronterBrainSymbol(void);
void RecordedBattle_SaveParties(void);
u8 GetActiveBattlerLinkPlayerGender(void);
void RecordedBattle_ClearFrontierPassFlag(void);
void RecordedBattle_SetFrontierPassFlagFromHword(u16 flags);
u8 RecordedBattle_GetFrontierPassFlag(void);
u8 GetBattleSceneInRecordedBattle(void);
u8 GetTextSpeedInRecordedBattle(void);
void RecordedBattle_CopyBattlerMoves(void);
void RecordedBattle_CheckMovesetChanges(u8 mode);
u32 GetAiScriptsInRecordedBattle(void);
void RecordedBattle_SetPlaybackFinished(void);
bool8 RecordedBattle_CanStopPlayback(void);
void GetRecordedBattleRecordMixFriendName(u8 *dst);
u8 GetRecordedBattleRecordMixFriendClass(void);
u8 GetRecordedBattleApprenticeId(void);
u8 GetRecordedBattleRecordMixFriendLanguage(void);
u8 GetRecordedBattleApprenticeLanguage(void);
void RecordedBattle_SaveBattleOutcome(void);
u16 *GetRecordedBattleEasyChatSpeech(void);

#endif // GUARD_RECORDED_BATTLE_H
