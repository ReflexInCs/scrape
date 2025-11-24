import { findByProps, findByStoreName } from "@vendetta/metro";
import { React, ReactNative, moment } from "@vendetta/metro/common";
import { after } from "@vendetta/patcher";
import { getAssetIDByName } from "@vendetta/ui/assets";
import { showToast } from "@vendetta/ui/toasts";
import { storage } from "@vendetta/plugin";
import { Forms } from "@vendetta/ui/components";

const { Text, View } = ReactNative;
const { FormRow, FormSection } = Forms;

// --- Modules ---
const FluxDispatcher = findByProps("dispatch", "subscribe");
const UserStore = findByStoreName("UserStore");
const PresenceStore = findByStoreName("PresenceStore");

// We try to find the User Profile Body component to patch
// This name varies by Discord version, but UserProfileBio or UserProfileBody is common
const UserProfileBody = findByProps("UserProfileBody") || findByProps("UserProfileBio"); 
const UserProfileSection = findByProps("UserProfileSection");

// --- Logic ---

let patches = [];

const handlePresenceUpdate = (data) => {
  try {
    const { user, status, guild_id } = data;
    if (!user || !user.id) return;

    // We only care if they are going offline
    // Note: 'invisible' status also sends 'offline'
    if (status === 'offline') {
      // Save the timestamp
      if (!storage.lastSeenData) storage.lastSeenData = {};
      storage.lastSeenData[user.id] = Date.now();
    } else {
      // If they come online, we could clear it, or keep the old "last seen" 
      // usually it's better to clear it so we know they are online now.
      if (storage.lastSeenData && storage.lastSeenData[user.id]) {
        delete storage.lastSeenData[user.id];
      }
    }
  } catch (e) {
    console.error("LastSeen: Error in presence update", e);
  }
};

const formatTime = (timestamp) => {
  if (!timestamp) return "Unknown";
  // Use Discord's moment.js if available, or standard Date
  try {
    return moment(timestamp).calendar();
  } catch (e) {
    return new Date(timestamp).toLocaleString();
  }
};

const LastSeenRow = ({ userId }) => {
  const [now, setNow] = React.useState(Date.now());
  
  // Re-render every minute to update relative time if needed
  React.useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(interval);
  }, []);

  const lastSeen = storage.lastSeenData?.[userId];
  const isOnline = PresenceStore.getStatus(userId) !== 'offline';

  if (isOnline) {
    return (
      <FormRow
        label="Last Seen"
        subLabel="Online Now"
        leading={<Forms.FormIcon source={getAssetIDByName("ic_activity_24px")} />}
      />
    );
  }

  if (!lastSeen) {
    return null; // Don't show anything if we haven't seen them yet
  }

  return (
    <FormRow
      label="Last Seen"
      subLabel={formatTime(lastSeen)}
      leading={<Forms.FormIcon source={getAssetIDByName("ic_history_24px")} />}
    />
  );
};

export default {
  onLoad: () => {
    // 1. Initialize Storage
    if (!storage.lastSeenData) storage.lastSeenData = {};

    // 2. Subscribe to Presence Updates
    FluxDispatcher.subscribe("PRESENCE_UPDATE", handlePresenceUpdate);

    // 3. Patch User Profile to display the data
    // We attempt to patch the section list or the body
    if (UserProfileBody) {
      patches.push(
        after("default", UserProfileBody, ([args], res) => {
          try {
            const user = args?.user;
            if (!user) return res;

            // Find a good place to inject. 
            // We'll return a React Fragment containing the original content + our row
            return (
              <React.Fragment>
                {res}
                <FormSection title="Activity">
                   <LastSeenRow userId={user.id} />
                </FormSection>
              </React.Fragment>
            );
          } catch (e) {
            return res;
          }
        })
      );
    } else if (UserProfileSection) {
       // Fallback patch if Body isn't found
       patches.push(
        after("default", UserProfileSection, ([args], res) => {
           // Logic would be similar, checking props for user object
           return res; 
        })
       );
    } else {
        showToast("LastSeen: Could not find User Profile component to patch.", getAssetIDByName("ic_warning_24px"));
    }
  },

  onUnload: () => {
    FluxDispatcher.unsubscribe("PRESENCE_UPDATE", handlePresenceUpdate);
    patches.forEach((unpatch) => unpatch());
    patches = [];
  }
};
