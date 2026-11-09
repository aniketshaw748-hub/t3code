import { createStaticNavigation } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import { useMobileNavigationTheme } from "../../lib/useMobileNavigationTheme";
import { ThreadRouteScreen } from "./ThreadRouteScreen";

/** An Android bubble shows one thread: no app chrome, no other routes, no deep links. */
const BubbleStack = createNativeStackNavigator({
  screens: {
    Thread: { screen: ThreadRouteScreen, options: { headerShown: false } },
  },
});
const Navigation = createStaticNavigation(BubbleStack);

export function bubbleThreadParams(path: string) {
  const [, segment, environmentId, threadId] = path.split("/");
  return segment === "threads" && environmentId && threadId ? { environmentId, threadId } : null;
}

export function BubbleThreadNavigation({ path }: { readonly path: string }) {
  const theme = useMobileNavigationTheme();
  const params = bubbleThreadParams(path);
  return (
    <Navigation
      theme={theme}
      initialState={{ routes: [{ name: "Thread", ...(params ? { params } : {}) }] }}
    />
  );
}
