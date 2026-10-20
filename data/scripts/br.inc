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

@ A door the match keeps shut (src/br/br_match.c, BrMatch_DoorClosed). The field locks
@ the controls whenever its input step says TRUE, and only a script or a warp lets go of
@ them: the refusal is neither, so this is what lets go (POK-432).
BR_EventScript_DoorClosed::
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

@ A CUT tree walked into (src/br/br_hm.c): VAR_LAST_TALKED is the tree, the cut-in is
@ skipped, and it comes down as EventScript_UseCut has it.
BR_EventScript_Cut::
	lockall
	dofieldeffect FLDEFF_USE_CUT_ON_TREE
	waitstate
	goto EventScript_CutTreeDown
	end

@ A in front of a boulder in a match: STRENGTH is already on (BrHm_AskStrength), so a
@ walk into it pushes. Nothing to say.
BR_EventScript_BoulderFree::
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

@ A TM nobody in the party can learn (BrItems_FindItem): it stays on the ground.
BR_EventScript_FoundLeft::
	msgbox gStringVar4, MSGBOX_DEFAULT
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

@ ...and a hidden one, which stays hidden: no flag.
BR_EventScript_FoundHiddenLeft::
	msgbox gStringVar4, MSGBOX_DEFAULT
	releaseall
	end

@ A town's gift-giver (src/br/br_loot.c): he turns to us and says his line (gStringVar4),
@ then hands it over. gStringVar2 is what it was; the item arrives with the bag's GIVE.
BR_EventScript_Gift::
	lock
	faceplayer
	msgbox gStringVar4, MSGBOX_DEFAULT
	special BrLoot_HomeClaim
	goto_if_eq VAR_RESULT, FALSE, BR_EventScript_GiftAsked
	waitstate
BR_EventScript_GiftAsked:
	special BrLoot_GiftTake
	goto_if_eq VAR_RESULT, FALSE, BR_EventScript_GiftGone
	goto_if_eq VAR_RESULT, 3, BR_EventScript_GiftGone
	playfanfare MUS_OBTAIN_ITEM
	goto_if_eq VAR_RESULT, 2, BR_EventScript_GiftMon
	message BR_Text_GiftReceived
BR_EventScript_GiftSaid:
	waitmessage
	waitfanfare
	waitbuttonpress
BR_EventScript_GiftGone:
	closemessage
	release
	end

@ A legendary standing on the ground (src/br/br_legend.c): the host asked for it, its cry
@ while he answers, then its battle or "got there first". VAR_0x8004 is its species.
BR_EventScript_Legend::
	lockall
	special BrLegend_Ask
	goto_if_eq VAR_RESULT, FALSE, BR_EventScript_LegendGone
	playmoncry VAR_0x8004, CRY_MODE_ENCOUNTER
	delay 40
	waitmoncry
	special BrLegend_Battle
	waitstate
BR_EventScript_LegendGone:
	releaseall
	end

@ ...and somebody at home's Pokemon (src/br/br_balls.c): no "the" in front of it.
BR_EventScript_GiftMon:
	message BR_Text_MonReceived
	goto BR_EventScript_GiftSaid

@ Somebody at home who trades (src/br/br_balls.c): the event trader's question, and
@ BrLoot_HomeTrade's swap. gStringVar1 is his.
BR_EventScript_HomeTrader::
	lockall
	msgbox BR_Text_TraderOffer, MSGBOX_YESNO
	goto_if_eq VAR_RESULT, NO, BR_EventScript_HomeTraderNo
	special ChoosePartyMon
	special BrLoot_HomeClaim
	goto_if_eq VAR_RESULT, FALSE, BR_EventScript_HomeTraderAsked
	waitstate
BR_EventScript_HomeTraderAsked:
	special BrLoot_HomeTrade
BR_EventScript_HomeTraderNo:
	releaseall
	end

@ An event's trader (src/br/br_event.c): any one of ours for his, at our rung. gStringVar1
@ is his. Once a match: the C says so without asking after that.
BR_EventScript_Trader::
	lockall
	msgbox BR_Text_TraderOffer, MSGBOX_YESNO
	goto_if_eq VAR_RESULT, NO, BR_EventScript_TraderNo
	special ChoosePartyMon
	special BrEvent_Trade
	goto_if_eq VAR_RESULT, FALSE, BR_EventScript_TraderNo
	waitstate
BR_EventScript_TraderNo:
	releaseall
	end

@ A story's gate (src/br/br_story.c, sPeople): the boss stands holding the reward and
@ hands it over when he falls. One page of speech, as a gym leader's, and the win's
@ script is the hand-over.
BR_EventScript_GateMaxieHideout::
	trainerbattle_single TRAINER_MAXIE_MAGMA_HIDEOUT, BR_Text_GateMaxieHideout, BR_Text_GateDefeat, BR_EventScript_GateBeaten, NO_MUSIC
	release
	end

BR_EventScript_GateArchie::
	trainerbattle_single TRAINER_ARCHIE, BR_Text_GateArchie, BR_Text_GateDefeat, BR_EventScript_GateBeaten, NO_MUSIC
	release
	end

BR_EventScript_GateShelly::
	trainerbattle_single TRAINER_SHELLY_WEATHER_INSTITUTE, BR_Text_GateShelly, BR_Text_GateDefeat, BR_EventScript_GateBeaten, NO_MUSIC
	release
	end

BR_EventScript_GateMatt::
	trainerbattle_single TRAINER_MATT, BR_Text_GateMatt, BR_Text_GateDefeat, BR_EventScript_GateBeaten, NO_MUSIC
	release
	end

BR_EventScript_GateMaxieChimney::
	trainerbattle_single TRAINER_MAXIE_MT_CHIMNEY, BR_Text_GateMaxieChimney, BR_Text_GateDefeat, BR_EventScript_GateBeaten, NO_MUSIC
	release
	end

BR_EventScript_GateMaxieSpace::
	trainerbattle_single TRAINER_MAXIE_MOSSDEEP, BR_Text_GateMaxieSpace, BR_Text_GateDefeat, BR_EventScript_GateBeaten, NO_MUSIC
	release
	end

BR_EventScript_GateBeaten::
	special BrStory_GateBeaten
	releaseall
	end

BR_Text_GateMaxieHideout:
	.string "MAXIE: GROUDON belongs to\n"
	.string "TEAM MAGMA. Turn back!$"

BR_Text_GateArchie:
	.string "ARCHIE: KYOGRE answers to\n"
	.string "TEAM AQUA alone!$"

BR_Text_GateShelly:
	.string "SHELLY: The weather's ours,\n"
	.string "and so is this CASTFORM!$"

BR_Text_GateMatt:
	.string "MATT: The boss's MASTER BALL?\n"
	.string "Come and take it, then!$"

BR_Text_GateMaxieChimney:
	.string "MAXIE: The METEORITE fuels\n"
	.string "our plan. Stand aside!$"

BR_Text_GateMaxieSpace:
	.string "MAXIE: This SUN STONE is\n"
	.string "TEAM MAGMA's now!$"

BR_Text_GateDefeat:
	.string "Hmph... Take it.$"

BR_Text_PartyFull:
	.string "Your party is full.\n"
	.string "Release one for the new catch?$"

BR_Text_GiftReceived:
	.string "{PLAYER} received\n"
	.string "the {STR_VAR_2}!$"

BR_Text_MonReceived:
	.string "{PLAYER} received\n"
	.string "{STR_VAR_2}!$"

BR_Text_TraderOffer:
	.string "My {STR_VAR_1} for any one of\n"
	.string "yours. Trade?$"

BR_Text_HealParty:
	.string "HEAL your party?$"

BR_Text_Healed:
	.string "Done.$"

BR_Text_CentreNo:
	.string "Good luck.$"

BR_Text_CentreClosed:
	.string "The fog is here.\n"
	.string "This CENTER is closed.$"
