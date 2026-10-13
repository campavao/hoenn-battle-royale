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

@ The water without the HMs (src/br/br_hm.c). Vanilla's own scripts, less the
@ checkpartymove that wanted a Pokemon with the move and the YES/NO that asked first.
@ Argument 0 is the Pokemon the cut-in would show, and BrHm_SkipCutIn skips it.
BR_EventScript_Surf::
	lockall
	setfieldeffectargument 0, 0
	dofieldeffect FLDEFF_USE_SURF
	releaseall
	end

BR_EventScript_Waterfall::
	lockall
	setfieldeffectargument 0, 0
	dofieldeffect FLDEFF_USE_WATERFALL
	releaseall
	end

@ Down at a dive spot and up from under one alike: the warp picks the way.
BR_EventScript_Dive::
	lockall
	setfieldeffectargument 0, 0
	setfieldeffectargument 1, 1
	dofieldeffect FLDEFF_USE_DIVE
	releaseall
	end

@ Std_FindItem's ball, when BrItems_FindItem took it: a vitamin on the whole party, a sell
@ item for its price, a pile of balls. gStringVar4 says which.
BR_EventScript_FoundUsed::
	removeobject VAR_LAST_TALKED
	playfanfare MUS_OBTAIN_ITEM
	msgbox gStringVar4, MSGBOX_DEFAULT
	waitfanfare
	release
	return

@ A hidden item that was used, sold or bagged as a pile (BrItems_FindHidden): the same
@ line, and pret's own flag, so it is not there to find twice.
BR_EventScript_FoundHiddenUsed::
	playfanfare MUS_OBTAIN_ITEM
	msgbox gStringVar4, MSGBOX_DEFAULT
	waitfanfare
	special SetHiddenItemFlag
	releaseall
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
