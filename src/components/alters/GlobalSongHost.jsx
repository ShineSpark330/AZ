// Plays the Song widget's track anywhere in the app when its "Play on every
// page" option is on. Yields to any page that has a song of its own, and (via
// the shared one-sound-at-a-time rule) to chat videos / audio, then picks back
// up once those stop.
import React, { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import ProfileSongPlayer from "@/components/alters/ProfileSongPlayer";
import { findEverywhereSong, pageSongCount, subscribePageSongs } from "@/lib/songPresence";

export default function GlobalSongHost() {
  const { data: settingsList = [] } = useQuery({
    queryKey: ["systemSettings"],
    queryFn: () => base44.entities.SystemSettings.list(),
  });
  const song = findEverywhereSong(settingsList[0]);
  const [pageSongs, setPageSongs] = useState(pageSongCount());
  useEffect(() => subscribePageSongs(setPageSongs), []);
  if (!song || pageSongs > 0) return null;
  return <ProfileSongPlayer everywhere song={{ ...song, playWhenIdle: true }} />;
}
