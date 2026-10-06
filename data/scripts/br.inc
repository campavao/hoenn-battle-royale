@ Battle royale field scripts. Assembled with --defsym BR=1; see src/br/.

@ A catch arrived with a full party (src/br/br_catch.c). Pick who gives way, or
@ cancel and the catch is gone. Kanto's "Fortnite rule": never a PC.
BR_EventScript_ReleaseOne::
	lockall
	msgbox BR_Text_PartyFull, MSGBOX_DEFAULT
	special ChoosePartyMon
	special BrCatch_Apply
	releaseall
	end

@ A gym leader fell (src/br/br_gym.c). The gym's own script here is the badge, its
@ fanfare, the badge's page, the TM and the TM's page -- with the fog closing. The purse
@ has already been paid in C; this lets go of the player and stops.
BR_EventScript_BossBeaten::
	releaseall
	end

@ NORMAN is a leader like the other seven (2026-10-06 play-test). His own script is a
@ switch over the story -- VAR_PETALBURG_GYM_STATE 7, past the boot, is the TM and
@ "Dad is going to keep training" -- and its fight is a trainerbattle_no_intro with the
@ badge written inline after it, so a match takes him the way it takes ROXANNE.
BR_EventScript_Norman::
	trainerbattle_single TRAINER_NORMAN_1, PetalburgCity_Gym_Text_NormanIntro, PetalburgCity_Gym_Text_NormanDefeat, BR_EventScript_BossBeaten, NO_MUSIC
	release
	end

BR_Text_PartyFull:
	.string "Your party is full.\n"
	.string "Release one for the new catch?$"

BR_Text_HealParty:
	.string "HEAL your party?$"

BR_Text_Healed:
	.string "Done.$"

BR_Text_CentreNo:
	.string "Good luck.$"

BR_Text_CentreClosed:
	.string "The fog is here.\n"
	.string "This CENTER is closed.$"
