#ifndef GUARD_BR_SKIN_H
#define GUARD_BR_SKIN_H

// The look a trainer picked in MY LOOK, everywhere the game draws that trainer (POK-411).
// A skin is an index into br_ghosts.c's sSkinGraphics (the walking sprite) and this
// file's sSkinPics (the battle picture), which line up entry for entry. The first four
// are BRENDAN and MAY, who have every picture pret draws; the rest are NPC classes with
// one walking sprite and one front picture, and no back picture, bike, seat on SURF or
// rod. Where the game wants one of those, an NPC look stands in with what it has.

// The skins below this are BRENDAN and MAY (and the RIVAL copies of them).
#define BR_SKIN_FIRST_NPC 4

// A skin's front battle picture, or `pic` for one this ROM does not know.
u16 BrSkin_Pic(u8 skin, u16 pic);
// Ours (gBrMySkin), for the Hall of Fame, the TRAINER CARD and the battle.
u16 BrSkin_MyPic(u16 pic);
// trainer_card.c: the TRAINER CARD's picture, ours or the followed trainer's.
u16 BrSkin_CardPic(u16 pic);
// TRUE when our look is an NPC's, which has no back picture and no bike or SURF sprites.
bool8 BrSkin_MyLookIsNpc(void);

// ---- the field ---------------------------------------------------------------
// field_player_avatar.c: the sprite our own object wears for pret's BRENDAN or MAY one.
// An NPC look walks, runs, cycles and surfs in its one standing sprite, as ghosts do
// (br_ghosts.c); the ones whose animations it has no frames for stay pret's.
u8 BrSkin_MyAvatar(u8 gfx);
// ...and which of the two we are, read back off that sprite: pret's own reading makes
// anything that is not MAY male.
u8 BrSkin_AvatarGender(u8 gfx);
// event_object_movement.c: an animation past the standard twenty (running, the hop onto
// SURF) asked of our object while it wears a look that has only those twenty.
u8 BrSkin_MyAnim(struct ObjectEvent *objectEvent, u8 anim, u8 standard);
// ...and a wait on one of our animations to end, which an NPC's never do: every one of
// the twenty loops. The field-move pose before SURF, CUT or STRENGTH waited for ever.
bool8 BrSkin_MyAnimEndless(struct ObjectEvent *objectEvent);

// ---- the MAP -----------------------------------------------------------------
// region_map.c: the head that marks us on the MAP and the fly map is BRENDAN's or MAY's.
// An NPC look has no head icon, so the middle of its walking sprite's first frame
// (face and shoulders, 16x16) goes over the one just loaded, in its own palette.
void BrSkin_MapIcon(u16 tileTag, u16 paletteTag);

// ---- the battle --------------------------------------------------------------
// Our trainer on the player's side, as the front picture turned to face the foe, when
// our look has no back picture. FALSE leaves pret to draw its back picture. The sprite
// starts x2 off its place and slides at speedX, as pret's does.
bool8 BrSkin_DrawMyPic(u8 battler, s16 x2, s16 speedX);
// ...in its two halves, for reshow_battle_screen.c, which loads every battler's pictures
// before it makes any of their sprites: the picture and its palette, then the sprite.
bool8 BrSkin_LoadMyPic(u8 battler);
bool8 BrSkin_CreateMyPic(u8 battler, s16 x2, s16 speedX);
// The palette pret loads for our picture's slide out of the intro, which is the back
// picture's: the front one's instead, for a picture BrSkin_DrawMyPic drew.
void BrSkin_MyThrowPalette(u8 paletteNum);
// The same for any skin: a spectator's replay draws both fighters in their looks.
bool8 BrSkin_DrawPic(u8 battler, u8 skin, s16 x2, s16 speedX);
void BrSkin_ThrowPalette(u8 skin, u8 paletteNum);

#endif // GUARD_BR_SKIN_H
