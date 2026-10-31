# ARQUIVO DE REFERENCIA - instalacao normal e feita pelo painel.
# Open Wi-Fi Cloud v1.3 - Managed Agent
# RouterOS 7.16.1
#
# IMPORTANTE:
# 1) A credencial individual e lida de openwifi-router.token.
# 2) O scheduler permanece em 10s.
# 3) O script só remove bindings com comment="OpenWiFi Cloud".
# 4) Bindings manuais não são alterados.
# 5) O binding Cloud copia address/to-address do HotSpot host.
# 6) Limites de velocidade usam Simple Queue com comment="OpenWiFi Cloud Queue".
# 7) Filas manuais nunca são removidas.

:local apiUrl "https://openwifi-api.cauaholiveira06.workers.dev/api/router/poll"
:local siteId "openwifi-main"
:local routerId "ROUTER_ID_GERADO_PELO_PAINEL"
:local token ""
:local tokenFile [/file find where name="openwifi-router.token"]
:if ([:len $tokenFile] = 0) do={
    :log error "OpenWiFi: arquivo de credencial ausente"
    :error "openwifi_token_missing"
}
:set token [/file get $tokenFile contents]

:local hostsJson "["
:local first true

:foreach h in=[/ip hotspot host print as-value] do={

    :local mac ($h->"mac-address")
    :local originalIp ($h->"address")
    :local hotspotIp ($h->"to-address")

    :if ([:len $mac] > 0) do={

        :if ($first = false) do={
            :set hostsJson ($hostsJson . ",")
        }

        :set hostsJson ($hostsJson . \
            "{\"mac\":\"" . $mac . \
            "\",\"ip\":\"" . $hotspotIp . \
            "\",\"originalIp\":\"" . $originalIp . "\"}")

        :set first false
    }
}

:set hostsJson ($hostsJson . "]")

:local identity [/system identity get name]
:local board [/system resource get board-name]
:local version [/system resource get version]
:local architecture [/system resource get architecture-name]
:local serial ""
:do { :set serial [/system routerboard get serial-number] } on-error={ :set serial "" }

:local payload ("{\"siteId\":\"" . $siteId . \
    "\",\"routerId\":\"" . $routerId . \
    "\",\"router\":{\"identity\":\"" . $identity . \
    "\",\"board\":\"" . $board . \
    "\",\"version\":\"" . $version . \
    "\",\"architecture\":\"" . $architecture . \
    "\",\"serial\":\"" . $serial . \
    "\"},\"hosts\":" . $hostsJson . "}")

:local result
:local fetchOk true

:do {

    :set result [/tool fetch \
        url=$apiUrl \
        http-method=post \
        http-header-field=("Authorization: Bearer " . $token . ",Content-Type: application/json") \
        http-data=$payload \
        output=user \
        as-value]

} on-error={

    :set fetchOk false
    :log warning "OpenWiFi Cloud fetch falhou"
}

:if ($fetchOk = true) do={

    :local response
    :local jsonOk true

    :do {
        :set response [:deserialize value=($result->"data") from=json]
    } on-error={
        :set jsonOk false
        :log warning "OpenWiFi Cloud JSON invalido"
    }

    :if ($jsonOk = true) do={

        :local deprovision ($response->"deprovision")

        :if ($deprovision = true) do={

            :log warning "OpenWiFi: integracao revogada pelo painel"

            :foreach bindingId in=[/ip hotspot ip-binding find where comment="OpenWiFi Cloud"] do={
                :local bindingMac [/ip hotspot ip-binding get $bindingId mac-address]

                :foreach activeId in=[/ip hotspot active find where mac-address=$bindingMac] do={
                    /ip hotspot active remove $activeId
                }

                :foreach cookieId in=[/ip hotspot cookie find where mac-address=$bindingMac] do={
                    /ip hotspot cookie remove $cookieId
                }

                /ip hotspot ip-binding remove $bindingId
            }

            :foreach queueId in=[/queue simple find where comment="OpenWiFi Cloud Queue"] do={
                /queue simple remove $queueId
            }

            :do {
                /tool fetch                     url="https://openwifi-api.cauaholiveira06.workers.dev/api/router/install-status"                     http-method=post                     http-header-field=("Authorization: Bearer " . $token . ",Content-Type: application/json")                     http-data="{\"status\":\"deprovisioned\",\"step\":\"stopped\",\"message\":\"Acessos Cloud removidos e agente pausado\"}"                     keep-result=no
            } on-error={}

            :foreach schedulerId in=[/system scheduler find where name="openwifi-cloud-poll"] do={
                /system scheduler disable $schedulerId
            }

            :put "OpenWiFi: integracao desativada"
            :return
        }

        :local access ($response->"access")

        # ============================================================
        # REVOGACAO
        # Remove SOMENTE bindings criados pelo Open Wi-Fi Cloud.
        # Tambem derruba sessao HotSpot/cookie do mesmo MAC.
        # ============================================================

        :foreach bindingId in=[/ip hotspot ip-binding find where comment="OpenWiFi Cloud"] do={

            :local bindingMac [/ip hotspot ip-binding get $bindingId mac-address]
            :local bindingMacText [:tostr $bindingMac]
            :local keep false

            :foreach item in=$access do={

                :local allowedMac ($item->"mac")

                :if ($bindingMacText = $allowedMac) do={
                    :set keep true
                }
            }

            :if ($keep = false) do={

                # Derruba qualquer sessao autenticada do mesmo MAC.
                :foreach activeId in=[/ip hotspot active find where mac-address=$bindingMac] do={
                    /ip hotspot active remove $activeId
                }

                # Remove cookie HotSpot remanescente do mesmo MAC.
                :foreach cookieId in=[/ip hotspot cookie find where mac-address=$bindingMac] do={
                    /ip hotspot cookie remove $cookieId
                }

                /ip hotspot ip-binding remove $bindingId

                :log info ("OpenWiFi Cloud REVOGADO: " . $bindingMacText)
            }
        }

        # ============================================================
        # LIBERACAO
        # Cria bypass somente se nao existir qualquer binding no MAC.
        # Nunca sobrescreve binding manual.
        # ============================================================

        :foreach item in=$access do={

            :local allowedMac ($item->"mac")
            :local downKbps ($item->"downKbps")
            :local upKbps ($item->"upKbps")

            :if ([:typeof $downKbps] = "nil") do={ :set downKbps 0 }
            :if ([:typeof $upKbps] = "nil") do={ :set upKbps 0 }

            # Recupera a tradução real que o HotSpot está usando para esse MAC.
            # Isso é essencial quando address e to-address são diferentes.
            :local hostFound false
            :local originalIp ""
            :local hotspotIp ""

            :foreach hostId in=[/ip hotspot host find where mac-address=$allowedMac] do={
                :if ($hostFound = false) do={
                    :set originalIp [/ip hotspot host get $hostId address]
                    :set hotspotIp [/ip hotspot host get $hostId to-address]
                    :set hostFound true
                }
            }

            :local existing [/ip hotspot ip-binding find where mac-address=$allowedMac]
            :local cloudExisting [/ip hotspot ip-binding find \
                where mac-address=$allowedMac and comment="OpenWiFi Cloud"]

            :if ([:len $existing] = 0) do={

                :if (($hostFound = true) and ([:len $originalIp] > 0) and ([:len $hotspotIp] > 0)) do={

                    /ip hotspot ip-binding add \
                        mac-address=$allowedMac \
                        address=$originalIp \
                        to-address=$hotspotIp \
                        server="openwifi-hotspot" \
                        type=bypassed \
                        comment="OpenWiFi Cloud"

                } else={

                    /ip hotspot ip-binding add \
                        mac-address=$allowedMac \
                        server="openwifi-hotspot" \
                        type=bypassed \
                        comment="OpenWiFi Cloud"
                }

                :log info ("OpenWiFi Cloud LIBERADO: " . $allowedMac)

            } else={

                :if ([:len $cloudExisting] > 0) do={

                    # Se o cliente mudou IP/MAC-private mapping, mantém o binding
                    # Cloud alinhado ao host atual sem tocar em bindings manuais.
                    :if (($hostFound = true) and ([:len $originalIp] > 0) and ([:len $hotspotIp] > 0)) do={

                        :foreach cloudId in=$cloudExisting do={
                            /ip hotspot ip-binding set $cloudId \
                                address=$originalIp \
                                to-address=$hotspotIp
                        }
                    }

                } else={

                    # Existe binding manual para o MAC. Respeita e não sobrescreve.
                }
            }

            # ========================================================
            # VELOCIDADE POR PRODUTO
            # Simple Queue é criada apenas para limites > 0.
            # max-limit usa upload/download no RouterOS.
            # ========================================================

            :local queueName ("OWIFI-" . $allowedMac)
            :local cloudQueue [/queue simple find where name=$queueName and comment="OpenWiFi Cloud Queue"]

            :if (($downKbps > 0) or ($upKbps > 0)) do={

                :if (($hostFound = true) and ([:len $hotspotIp] > 0)) do={

                    :local queueTarget ($hotspotIp . "/32")
                    :local maxLimit (($upKbps . "k") . "/" . ($downKbps . "k"))

                    :if ([:len $cloudQueue] = 0) do={

                        /queue simple add                             name=$queueName                             target=$queueTarget                             max-limit=$maxLimit                             comment="OpenWiFi Cloud Queue"

                    } else={

                        :foreach queueId in=$cloudQueue do={
                            /queue simple set $queueId                                 target=$queueTarget                                 max-limit=$maxLimit
                        }
                    }
                }

            } else={

                :if ([:len $cloudQueue] > 0) do={
                    /queue simple remove $cloudQueue
                }
            }
        }

        # ============================================================
        # LIMPEZA DE FILAS CLOUD
        # Remove fila de MAC que não está mais autorizado/limitado.
        # ============================================================

        :foreach queueId in=[/queue simple find where comment="OpenWiFi Cloud Queue"] do={

            :local queueName [/queue simple get $queueId name]
            :local keepQueue false

            :foreach item in=$access do={

                :local allowedMac ($item->"mac")
                :local downKbps ($item->"downKbps")
                :local upKbps ($item->"upKbps")

                :if ([:typeof $downKbps] = "nil") do={ :set downKbps 0 }
                :if ([:typeof $upKbps] = "nil") do={ :set upKbps 0 }

                :local expectedName ("OWIFI-" . $allowedMac)

                :if (($queueName = $expectedName) and (($downKbps > 0) or ($upKbps > 0))) do={
                    :set keepQueue true
                }
            }

            :if ($keepQueue = false) do={
                /queue simple remove $queueId
            }
        }
    }
}
