import { useEffect, useState } from "react";

export function useUserLocation() {
  const [userLocation, setUserLocation] = useState(null);

  useEffect(() => {
    if (!navigator.geolocation) return undefined;

    const watcher = navigator.geolocation.watchPosition(
      (position) => {
        setUserLocation({
          lon: position.coords.longitude,
          lat: position.coords.latitude,
          accuracy: position.coords.accuracy || null,
          heading: Number.isFinite(position.coords.heading) ? position.coords.heading : null,
          speed: Number.isFinite(position.coords.speed) ? position.coords.speed : null
        });
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 900, timeout: 12000 }
    );

    return () => navigator.geolocation.clearWatch(watcher);
  }, []);

  return userLocation;
}
