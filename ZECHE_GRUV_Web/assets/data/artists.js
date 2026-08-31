// ---------- Roster de artistas ZECHE GRUV ----------
// Fuente única de datos: la usan tanto la home (grilla de artistas) como
// el generador de páginas individuales (scripts/generate-artist-pages.mjs).
// Editá este array para agregar, sacar o reordenar artistas — el slug
// (para la URL de su página) y la bio se completan/recalculan solos.
//
// "bio": null hasta tener texto real confirmado para ese artista — la
// página del artista muestra "Biografía próximamente" mientras tanto.
(function (root) {
  function slugify(name) {
    return name
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  const RAW_ARTISTS = [
    { name: "Kires", id: "1Cm1WPdQpZWR1FGoaCQ9Hu", img: "ab67616100005174eb78ac9059f304cd9a71f78d" },
    { name: "Rouse bby", id: "5CNzLOwiQx5VhTv44SuCm9", img: "ab67616100005174b011ca6ee23cca7df223bea7" },
    { name: "Pazz", id: "38QjfFQ2Qj5pYKEfP1UZXz", img: "ab67616100005174eda1fcc84a4898da3737c123" },
    { name: "Midel", id: "4EcIU574ksr6mC1GMEOe0p", img: "ab67616100005174f8dc60cf6517ac24c1b2134f" },
    { name: "Mc Nito", id: "0EOOwVUWdPElrXOJyKOiBw", img: "ab676161000051743450ced305b10b708633b2a8" },
    { name: "Kamacho", id: "4w0n2oYb0ZEuvlHa1Mnxci", img: "ab676161000051740e18544b9ed4c07c536e5cea" },
    { name: "Kizuato", id: "1CDBZ6ZYceJMFEj5lMn1yi", img: "ab67616100005174a81ff0f069a0bdb8c73e1138" },
    { name: "BR1", id: "3sqbHtwHxDZQfqFkr03zwX", img: "ab67616100005174ecf99b8b37813daeba89fc7d" },
    { name: "Casteyano", id: "2sAeYCtKB9km4OnxZ79F2W", img: "ab6761610000517448dc2e35568059fd450e05f8" },
    { name: "Majo Chicar", id: "2t1ZWcvmcsJnj9yCRuzvOG", img: "ab67616100005174b43f4244290797303000e856" },
    { name: "Pastelita", id: "5sSiBj6y3adorU3bNcO0qi", img: "ab676161000051742108e15dfdfec3a28581c9af" },
    { name: "Sorriso", id: "4EIzdaX8jUM4b2zKCYh1yj", img: "ab67616100005174d7dff70bb01d856e75ac1177" },
    { name: "Tobi Matarasso", id: "758gJCoI4xZWRgjdlww3iM", img: "ab676161000051746febd6cd6725b013ad63d440" },
    { name: "Mc Anrry", id: "4ExMusmx318A1cgA2L2UAP", img: "ab6761610000517456d65d3fdf9e10f05e8db909" },
    { name: "Axia Bebe", id: "0ku2WIox3Gy8ZeRTra7khQ", img: "ab67616100005174cbfde070c1a24407419e14df" },
    { name: "Lusan", id: "6cdFVBWLuWaXod5b0IqQvx", img: "ab676161000051745f55d7e03eb9c9995a20d988" },
    { name: "Borja Trece", id: "6IsD7NahqpNXMZokr2sScx", img: "ab67616100005174e65017044d47c1044f1fbbb9" },
    { name: "Bhae", id: "3rpv3PztUChhUTcNhHHRku", img: "ab67616100005174eb042c34dfcb55cba82fb4ea" },
    { name: "Anita Pau", id: "1KMisYLHu9wM1dsT4gTwZz", img: "ab67616100005174b7f942eba8a4c91ca8300378" },
    { name: "Layla Mar", id: "0FFp6MN2W3zcJdWAkCxcg6", img: "ab67616100005174dc1219d7f375fd39ce3bcdc9" },
    { name: "Maki", id: "4q0qAJSJMhF3n8nq9n2gJX", img: "ab67616d00001e02c8c1cd702aae848113ab6d14" },
    { name: "Yaco Santana", id: "0qyQT0AI2Qz2PnOP49ZBtA", img: "ab676161000051746665734a01adfe495ea805cb" },
    { name: "Bianca Biondi", id: "4AhBUp7hKgyNz915uFsmCc", img: "ab67616100005174f738fb7c0cd6b181f348bae0" },
    { name: "Jugo Solar", id: "5x69KadluL7PwtwALZrTgm", img: "ab67616100005174ddf9601225b8b08e7fd411d9" },
    { name: "BallerFk", id: "2kENb15y49pTplwxt9ivd5", img: "ab67616100005174981ebb77880358490b75057f" },
    { name: "Ekiss", id: "20mwpOinpbsbDIgnqUpFBe", img: "ab676161000051743b923eed0abd5ccb9e01ef0c" },
    { name: "Lowkey Santo", id: "31xbC0RlsTJT1NOLviy6lD", img: "ab676161000051744014c930fa3816a9ec333669" },
  ];

  const ARTISTS = RAW_ARTISTS.map((a) => ({
    ...a,
    slug: slugify(a.name),
    bio: null,
  }));

  if (typeof module !== "undefined" && module.exports) {
    module.exports = ARTISTS;
  }
  if (root) {
    root.ZG_ARTISTS = ARTISTS;
  }
})(typeof window !== "undefined" ? window : null);
