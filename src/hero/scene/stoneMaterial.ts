import * as THREE from 'three';

export interface StoneTextures {
  albedo: THREE.Texture;
  normal: THREE.Texture;
  orm: THREE.Texture;
  noise: THREE.Texture;
}

/** Uniforms shared by every stone surface so the core can light the fracture faces. */
export interface CoreGlowUniforms {
  uCorePos: { value: THREE.Vector3 };
  uCoreColor: { value: THREE.Color };
  uCoreIntensity: { value: number };
}

/**
 * Physically based basalt: MeshStandardMaterial with triplanar sampling of the
 * albedo / normal / ORM set in object space (no UVs needed, texture sticks to the
 * moving stones), macro tone variation to hide tiling, and a faint emissive seep
 * in cavities close to the energy core.
 */
export function createStoneMaterial(
  tex: StoneTextures,
  glow: CoreGlowUniforms,
  opts: { tint?: THREE.ColorRepresentation; texScale?: number; normalStrength?: number; envMapIntensity?: number; glowFalloff?: number } = {},
): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color: opts.tint ?? 0xffffff,
    roughness: 1,
    metalness: 0,
    envMapIntensity: opts.envMapIntensity ?? 0.35,
  });

  const uniforms = {
    uAlbedo: { value: tex.albedo },
    uNormalTex: { value: tex.normal },
    uOrm: { value: tex.orm },
    uMacro: { value: tex.noise },
    uTexScale: { value: opts.texScale ?? 0.85 },
    uNormalStrength: { value: opts.normalStrength ?? 1.35 },
    uGlowFalloff: { value: opts.glowFalloff ?? 2.6 },
    ...glow,
  };

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        attribute vec2 aCavity;
        varying vec2 vCavity;
        varying vec3 vTriPos;
        varying vec3 vTriNormal;
        varying vec3 vAxisX;
        varying vec3 vAxisY;
        varying vec3 vAxisZ;
        varying vec3 vStoneWorld;`,
      )
      .replace(
        '#include <worldpos_vertex>',
        /* glsl */ `#include <worldpos_vertex>
        vTriPos = position;
        vTriNormal = normal;
        vCavity = aCavity;
        mat3 triM = mat3(1.0);
        vec4 triWorld = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          triM = mat3(instanceMatrix);
          triWorld = instanceMatrix * triWorld;
        #endif
        vAxisX = normalize(normalMatrix * (triM * vec3(1.0, 0.0, 0.0)));
        vAxisY = normalize(normalMatrix * (triM * vec3(0.0, 1.0, 0.0)));
        vAxisZ = normalize(normalMatrix * (triM * vec3(0.0, 0.0, 1.0)));
        vStoneWorld = (modelMatrix * triWorld).xyz;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        uniform sampler2D uAlbedo;
        uniform sampler2D uNormalTex;
        uniform sampler2D uOrm;
        uniform sampler2D uMacro;
        uniform float uTexScale;
        uniform float uNormalStrength;
        uniform float uGlowFalloff;
        uniform vec3 uCorePos;
        uniform vec3 uCoreColor;
        uniform float uCoreIntensity;
        varying vec2 vCavity;
        varying vec3 vTriPos;
        varying vec3 vTriNormal;
        varying vec3 vAxisX;
        varying vec3 vAxisY;
        varying vec3 vAxisZ;
        varying vec3 vStoneWorld;`,
      )
      .replace(
        '#include <map_fragment>',
        /* glsl */ `
        vec3 triN = normalize(vTriNormal);
        vec3 triW = pow(abs(triN), vec3(4.0));
        triW /= (triW.x + triW.y + triW.z);
        vec3 triP = vTriPos * uTexScale;
        vec2 uvX = triP.zy + vec2(0.13, 0.41);
        vec2 uvY = triP.xz + vec2(0.57, 0.29);
        vec2 uvZ = triP.xy + vec2(0.83, 0.07);

        vec3 triAlbedo =
          texture2D(uAlbedo, uvX).rgb * triW.x +
          texture2D(uAlbedo, uvY).rgb * triW.y +
          texture2D(uAlbedo, uvZ).rgb * triW.z;
        vec3 triOrm =
          texture2D(uOrm, uvX).rgb * triW.x +
          texture2D(uOrm, uvY).rgb * triW.y +
          texture2D(uOrm, uvZ).rgb * triW.z;

        // Large-scale tonal variation (breaks up visible tiling).
        vec3 mp = vTriPos * 0.19;
        float macro =
          texture2D(uMacro, mp.zy).r * triW.x +
          texture2D(uMacro, mp.xz).r * triW.y +
          texture2D(uMacro, mp.xy).r * triW.z;
        triAlbedo *= mix(0.6, 1.3, macro);
        // Baked curvature: dark creases, slightly worn (lighter) convex edges.
        triAlbedo *= mix(0.45, 1.0, vCavity.x) * (1.0 + vCavity.y * 0.85);

        diffuseColor.rgb *= triAlbedo;`,
      )
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = roughness * triOrm.g;')
      .replace(
        '#include <normal_fragment_maps>',
        /* glsl */ `
        vec3 tnx = texture2D(uNormalTex, uvX).xyz * 2.0 - 1.0;
        vec3 tny = texture2D(uNormalTex, uvY).xyz * 2.0 - 1.0;
        vec3 tnz = texture2D(uNormalTex, uvZ).xyz * 2.0 - 1.0;
        tnx.xy *= uNormalStrength;
        tny.xy *= uNormalStrength;
        tnz.xy *= uNormalStrength;
        // Whiteout-blended triplanar normals (object space).
        tnx = vec3(tnx.xy + triN.zy, abs(tnx.z) * triN.x);
        tny = vec3(tny.xy + triN.xz, abs(tny.z) * triN.y);
        tnz = vec3(tnz.xy + triN.xy, abs(tnz.z) * triN.z);
        vec3 nObj = normalize(tnx.zyx * triW.x + tny.xzy * triW.y + tnz.xyz * triW.z);
        normal = normalize(nObj.x * vAxisX + nObj.y * vAxisY + nObj.z * vAxisZ);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
        float coreDist = length(vStoneWorld - uCorePos);
        float seep = exp(-coreDist * uGlowFalloff);
        float cavity = smoothstep(0.62, 0.22, triOrm.r * vCavity.x);
        totalEmissiveRadiance += uCoreColor * uCoreIntensity * seep * (0.035 + cavity * 0.55);`,
      )
      .replace(
        '#include <aomap_fragment>',
        /* glsl */ `
        float ambientOcclusion = triOrm.r * vCavity.x;
        reflectedLight.indirectDiffuse *= ambientOcclusion;
        reflectedLight.directDiffuse *= mix(1.0, ambientOcclusion, 0.45);
        #if defined( USE_ENVMAP ) && defined( STANDARD )
          float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
          reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNV, ambientOcclusion, material.roughness );
        #endif`,
      );
  };
  mat.customProgramCacheKey = () => 'triplanar-stone-v1';
  return mat;
}
