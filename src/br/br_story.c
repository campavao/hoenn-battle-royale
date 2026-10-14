// Story events' places. See include/br/br_story.h.
#include "global.h"
#include "event_data.h"
#include "constants/flags.h"
#include "br/br_match.h"
#include "br/br_story.h"

bool8 BrStory_Tide(void)
{
    if (gBrMatch.seed == 0)
        return FALSE;
    FlagClear(FLAG_SYS_SHOAL_TIDE); // clear is low: the layouts' own LOW_TIDE rooms
    return TRUE;
}
