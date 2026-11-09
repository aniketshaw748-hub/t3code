/**
 * The product identity of this build. Everything that names the app, keeps its data apart from
 * other installs, or points at its release and support channels reads from here, so renaming
 * the product means editing this file and replacing `assets.directory`.
 *
 * Dependency-free on purpose: build scripts, the Expo config and every package import it.
 */

export type BrandChannel = "production" | "preview" | "development";

export interface Brand {
  /** The product name users see. */
  readonly displayName: string;
  /** Lowercase name for directories, executables, service units and file names. */
  readonly slug: string;
  /** Reverse-DNS application id: desktop appId and AUMID, macOS plist domain, launchd labels. */
  readonly appId: string;
  /** Mixed-case reverse-DNS id for freedesktop entries and D-Bus names. */
  readonly linuxAppId: string;
  /** The CLI command, and the name of the launchers that install it. */
  readonly cliName: string;
  /** The default data directory under the user's home (`T3CODE_HOME` still overrides it). */
  readonly homeDirName: string;
  readonly urlSchemes: Readonly<Record<BrandChannel, string>>;
  /** Shown as the publisher and Linux package maintainer. */
  readonly publisher: string;
  readonly contactEmail: string;
  /** `owner/name` on GitHub: release downloads, update feeds, issues and docs. */
  readonly repository: string;
  readonly desktop: {
    /** Electron profile directory names under the OS app-data directory. */
    readonly userDataDirNames: { readonly production: string; readonly development: string };
    /**
     * Older profile names of this same product to migrate Windows credential keys and
     * localStorage from. Never list another product's profile: that imports its secrets.
     */
    readonly legacyUserDataDirNames: {
      readonly production: ReadonlyArray<string>;
      readonly development: ReadonlyArray<string>;
    };
  };
  readonly mobile: {
    readonly appIds: Readonly<Record<BrandChannel, string>>;
    /** Expo/EAS project; unset builds without OTA updates or EAS services. */
    readonly easProjectId: string | undefined;
    readonly easOwner: string | undefined;
    readonly appleTeamId: string | undefined;
  };
  readonly policy: {
    /** Folder holding `policy.json` under Program Files and Application Support. */
    readonly directoryName: string;
    /** Registry key Group Policy writes, below HKLM. */
    readonly windowsRegistrySubkey: string;
    /** Group Policy ADMX namespace. */
    readonly admxNamespace: string;
  };
  /**
   * Hosted services. T3 Connect (relay, Clerk and the hosted web app) is run by T3 Tools; swap
   * these with the relay and Clerk settings in `.env` to self-host.
   */
  readonly hosted: {
    readonly appUrl: string;
    readonly clerkDomain: string;
  };
  readonly links: {
    readonly website: string;
    readonly download: string;
    readonly privacyPolicy: string;
    /** Where to get the mobile apps; Settings shows one QR code per entry. */
    readonly mobileApps: ReadonlyArray<{
      readonly platform: "ios" | "android";
      readonly store: string;
      readonly url: string;
    }>;
  };
  /** Product analytics; no key means analytics are off. Local tracing is unaffected. */
  readonly analytics: {
    readonly posthogKey: string | undefined;
    readonly posthogHost: string | undefined;
  };
  /** Product defaults that differ between builds. */
  readonly defaults: {
    /** Whether a newly linked T3 Connect environment publishes agent activity to phones. */
    readonly publishAgentActivity: boolean;
  };
  readonly assets: {
    /** Repo-relative folder with `dev/`, `nightly/`, `prod/` and `android/` icon sets. */
    readonly directory: string;
  };
}

const REPOSITORY = "aniketshaw748-hub/t3code";
const REPOSITORY_URL = `https://github.com/${REPOSITORY}`;

export const BRAND: Brand = {
  displayName: "Kavyaan",
  slug: "kavyaan",
  appId: "dev.kavyaan.app",
  linuxAppId: "dev.kavyaan.Kavyaan",
  cliName: "kavyaan",
  homeDirName: ".kavyaan",
  urlSchemes: {
    production: "kavyaan",
    preview: "kavyaan-preview",
    development: "kavyaan-dev",
  },
  publisher: "Aniket Shaw",
  contactEmail: "aniketshaw748-hub@users.noreply.github.com",
  repository: REPOSITORY,
  desktop: {
    userDataDirNames: { production: "kavyaan", development: "kavyaan-dev" },
    legacyUserDataDirNames: { production: [], development: [] },
  },
  mobile: {
    appIds: {
      production: "dev.kavyaan.app",
      preview: "dev.kavyaan.app.preview",
      development: "dev.kavyaan.app.dev",
    },
    easProjectId: undefined,
    easOwner: undefined,
    appleTeamId: undefined,
  },
  policy: {
    directoryName: "Kavyaan",
    windowsRegistrySubkey: "SOFTWARE\\Policies\\Kavyaan\\Kavyaan",
    admxNamespace: "Kavyaan.Policies.Kavyaan",
  },
  hosted: {
    appUrl: "https://app.t3.codes",
    clerkDomain: "clerk.t3.codes",
  },
  links: {
    website: REPOSITORY_URL,
    download: `${REPOSITORY_URL}/releases`,
    privacyPolicy: `${REPOSITORY_URL}#readme`,
    mobileApps: [
      { platform: "android", store: "GitHub Releases", url: `${REPOSITORY_URL}/releases` },
    ],
  },
  analytics: {
    posthogKey: undefined,
    posthogHost: undefined,
  },
  defaults: {
    publishAgentActivity: true,
  },
  assets: {
    directory: "assets/kavyaan",
  },
};

export const BRAND_REPOSITORY_URL = REPOSITORY_URL;
export const BRAND_RELEASES_URL = `${REPOSITORY_URL}/releases`;
export const BRAND_ISSUES_URL = `${REPOSITORY_URL}/issues`;

/** A link to a file on the repository's main branch, such as `docs/user/faq.md`. */
export function brandRepositoryFileUrl(filePath: string): string {
  return `${REPOSITORY_URL}/blob/main/${filePath}`;
}

/** "Kavyaan (Beta)", the name of one release stage. */
export function brandStageName(stageLabel: string): string {
  return `${BRAND.displayName} (${stageLabel})`;
}

/** The URL scheme the desktop app and its auth handoffs use. */
export function brandDesktopScheme(isDevelopment: boolean): string {
  return isDevelopment ? BRAND.urlSchemes.development : BRAND.urlSchemes.production;
}

/** Who the app's own Git commits, such as turn checkpoints, are authored by. */
export const BRAND_GIT_IDENTITY = {
  name: BRAND.displayName,
  email: `${BRAND.slug}@users.noreply.github.com`,
} as const;

/** The CLI launcher file name on `platform`. */
export function brandCliLauncherName(platform: string): string {
  return platform === "win32" ? `${BRAND.cliName}.cmd` : BRAND.cliName;
}
