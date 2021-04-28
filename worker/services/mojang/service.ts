/// <reference path="./mojang.d.ts">

import PromiseGatherer from '../../promise_gather';
import {IdentityKind, CraftheadRequest} from '../../request';
import {STEVE_SKIN} from '../../data';
import {MojangApiService, MojangProfile, MojangProfileProperty} from "./api";
import { CacheComputeResult, computeBuffer } from '../../util/cache-helper';

declare const CRAFTHEAD_PROFILE_CACHE: KVNamespace;

const FAKE_MHF_STEVE_UUID = '!112548de8d0c42a78745aabac5a64ebb';

export interface SkinResponse {
    response: Response;
    profile: MojangProfile | null;
}

interface MojangTextureUrls {
    SKIN: { url: string } | undefined;
    CAPE: { url: string } | undefined;
}

interface MojangTexturePropertyValue {
    textures: MojangTextureUrls;
}

export default class MojangRequestService {
    private mojangApi: MojangApiService;

    constructor(mojangApi: MojangApiService) {
        this.mojangApi = mojangApi;
    }

    /**
     * Normalizes the incoming request, such that we only work with UUIDs. A new request bearing an UUID is returned.
     * @param request the incoming request
     * @param gatherer any promise gatherer
     */
    async normalizeRequest(request: CraftheadRequest, gatherer: PromiseGatherer): Promise<CraftheadRequest> {
        if (request.identityType === IdentityKind.Uuid) {
            return request;
        }

        const normalized: CraftheadRequest = Object.assign({}, request);
        normalized.identityType = IdentityKind.Uuid;

        const profileLookup = await this.mojangApi.lookupUsername(request.identity, gatherer);
        if (profileLookup) {
            normalized.identity = profileLookup.id;
        } else {
            // The lookup failed.
            normalized.identity = FAKE_MHF_STEVE_UUID;
        }
        return normalized;
    }

    async retrieveSkin(request: CraftheadRequest, gatherer: PromiseGatherer): Promise<Response> {
        if (request.identity === 'char' || request.identity === 'MHF_Steve' || request.identity === FAKE_MHF_STEVE_UUID) {
            // These are special-cased by Minotar.
            return new Response(STEVE_SKIN);
        }

        const normalized = await this.normalizeRequest(request, gatherer);

        const cacheKey = `skin:${normalized.identity}`
        const response = await computeBuffer(cacheKey, async () => {
            const lookup = await this.mojangApi.fetchProfile(normalized.identity, gatherer);
            if (lookup.result !== null) {
                let skinResponse = await this.fetchSkinTextureFromProfile(lookup.result);
                return skinResponse.arrayBuffer();
            }
            return null;
        }, gatherer);

        if (response.result) {
            return new Response(response.result, {
                status: 200,
                headers: {
                    'X-Crafthead-Skin-Cache-Hit': response.source
                }
            });
        } else {
            return new Response(STEVE_SKIN);
        }
    }

    private async fetchSkinTextureFromProfile(profile: MojangProfile): Promise<Response> {
        if (profile.properties) {
            const textureUrl = MojangRequestService.extractUrlFromTexturesProperty(
                profile.properties.find(property => property.name === 'textures'));
            if (textureUrl) {
                const textureResponse = await fetch(textureUrl);
                if (!textureResponse.ok) {
                    throw new Error(`Unable to retrieve skin texture from Mojang, http status ${textureResponse.status}`);
                }

                console.log("Successfully retrieved skin texture");
                return textureResponse;
            }
        }

        console.log("Invalid properties found! Falling back to Steve skin.")
        return new Response(STEVE_SKIN);
    }

    async fetchProfile(request: CraftheadRequest, gatherer: PromiseGatherer): Promise<CacheComputeResult<MojangProfile | null>> {
        const normalized = await this.normalizeRequest(request, gatherer);
        if (normalized.identity === FAKE_MHF_STEVE_UUID) {
            return {
                result: null,
                source: 'mojang'
            };
        }
        return this.mojangApi.fetchProfile(normalized.identity, gatherer);
    }

    private static extractUrlFromTexturesProperty(property: MojangProfileProperty | undefined): string | undefined {
        if (typeof property === 'undefined') {
            return undefined;
        }

        const rawJson = atob(property.value);
        const decoded: MojangTexturePropertyValue = JSON.parse(rawJson);
        console.log("Raw textures property: ", property);

        const textures = decoded.textures;
        return textures.SKIN?.url;
    }
}