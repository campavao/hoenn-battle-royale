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
